"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Camera } from "@/lib/google";
import { apiFetch } from "@/lib/client-fetch";
import { pauseFor, schedule } from "@/lib/stream-budget";
import { useInView, usePageActive } from "@/lib/use-activity";
import { useLocalStorageState } from "@/lib/use-local-storage";

type Status = "connecting" | "live" | "waking" | "throttled" | "error" | "unsupported" | "paused";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const EXTEND_LEAD_MS = 60_000; // renew this long before SDM's expiresAt
const BACKOFF_BASE_MS = 3_000;
const BACKOFF_MAX_MS = 60_000;
const BACKOFF_MAX_LONG_MS = 5 * 60_000; // after repeated failures (e.g. dead battery)
const LONG_BACKOFF_AFTER = 6;
const RATE_LIMIT_PAUSE_MS = 30_000; // default hold when Google says 429 and gives no Retry-After
const HIDDEN_GRACE_MS = 60_000; // tab hidden this long => release the streams (saves Google quota)
const OFFSCREEN_GRACE_MS = 45_000; // tile scrolled away this long => release its stream
const ICE_GATHER_TIMEOUT_MS = 2_000;
const DISCONNECT_GRACE_MS = 5_000;
const STALL_CHECK_MS = 10_000; // frozen-frame watchdog cadence
const STALL_AFTER_CHECKS = 3; // ~30s without the clock advancing => rebuild the session

type StreamError = Error & { code?: string; retryAfterMs?: number };

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    const timer = window.setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

async function postStreamNow<T>(cameraId: string, body: Record<string, string>, keepalive = false): Promise<T> {
  const res = await apiFetch(`/api/cameras/${encodeURIComponent(cameraId)}/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) {
    const err: StreamError = new Error(data.error || `Request failed (${res.status})`);
    err.code = data.code;
    if (res.status === 429 || data.code === "RESOURCE_EXHAUSTED") {
      const ra = Number(res.headers.get("Retry-After"));
      err.retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : RATE_LIMIT_PAUSE_MS;
      pauseFor(err.retryAfterMs); // hold every tile, not just this one
    }
    throw err;
  }
  return data;
}

/** Every Google camera command goes through the shared per-tab budget. 0 = renew, 1 = start, 2 = stop. */
function postStream<T>(cameraId: string, body: Record<string, string>, priority: 0 | 1 | 2, cancelled: () => boolean = () => false): Promise<T> {
  return schedule(priority, () => postStreamNow<T>(cameraId, body), cancelled);
}

function stopSession(cameraId: string, mediaSessionId: string, unloading = false) {
  // On page unload only a keepalive fetch survives; otherwise queue it at the lowest priority.
  const p = unloading ? postStreamNow(cameraId, { stop: mediaSessionId }, true) : postStream(cameraId, { stop: mediaSessionId }, 2);
  void p.catch(() => {});
}

/** natural: frame follows the stream's own shape. wide: every tile is 16:9 and the video fills it (portrait feeds get cropped). */
export type TileShape = "natural" | "wide";

type Props = {
  camera: Camera;
  index: number;
  shape: TileShape;
  expanded: boolean;
  onToggleExpand: () => void;
};

export function CameraTile({ camera, index, shape, expanded, onToggleExpand }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const backoffRef = useRef(0);
  const [status, setStatus] = useState<Status>(camera.webrtc ? "connecting" : "unsupported");
  const [message, setMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [aspect, setAspect] = useState<number | null>(null);
  // Last known shape for this camera on this device, so tiles don't jump on later loads.
  const [savedAspect, setSavedAspect] = useLocalStorageState<number | null>(`homeops:aspect:${camera.id}`, null);
  // Only spend Google quota on tiles someone can actually see.
  const pageActive = usePageActive(HIDDEN_GRACE_MS);
  const inView = useInView(frameRef, OFFSCREEN_GRACE_MS);
  const active = pageActive && inView;

  const retryNow = useCallback(() => {
    backoffRef.current = 0;
    setAttempt((a) => a + 1);
  }, []);

  // One WebRTC session per `attempt`. Cleanup tears it down; a retry bumps `attempt`.
  useEffect(() => {
    if (!camera.webrtc || !active) return; // paused tiles are derived in render, nothing to start
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let mediaSessionId: string | null = null;
    let extendTimer: number | undefined;
    let retryTimer: number | undefined;
    let graceTimer: number | undefined;
    let stallTimer: number | undefined;

    const teardown = () => {
      window.clearTimeout(extendTimer);
      window.clearTimeout(graceTimer);
      window.clearInterval(stallTimer);
      if (pc) {
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
        pc = null;
      }
      if (mediaSessionId) {
        stopSession(camera.id, mediaSessionId, unloading);
        mediaSessionId = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    let unloading = false;
    const onUnload = () => {
      unloading = true;
    };
    window.addEventListener("pagehide", onUnload);

    const scheduleRetry = (why: string, kind: "error" | "waking" | "throttled" = "error", retryAfterMs?: number) => {
      if (cancelled) return;
      let delay: number;
      if (kind === "throttled") {
        // Not the camera's fault: wait out Google's hold, then let the shared queue pace us. No exponential growth.
        delay = (retryAfterMs ?? RATE_LIMIT_PAUSE_MS) + 1_000 + Math.random() * 4_000;
      } else {
        const n = backoffRef.current++;
        const cap = n >= LONG_BACKOFF_AFTER ? BACKOFF_MAX_LONG_MS : BACKOFF_MAX_MS;
        delay = Math.min(cap, BACKOFF_BASE_MS * 2 ** n) * (0.8 + Math.random() * 0.4);
      }
      setStatus(kind);
      setMessage(why);
      retryTimer = window.setTimeout(() => setAttempt((a) => a + 1), delay);
    };

    const classify = (e: StreamError): Parameters<typeof scheduleRetry> => {
      if (e.code === "RESOURCE_EXHAUSTED") return ["Waiting for Google's camera quota", "throttled", e.retryAfterMs];
      if (e.code === "FAILED_PRECONDITION" || /offline|asleep/i.test(e.message)) return ["Asleep, dead battery, or unplugged", "waking"];
      return [e.message || "Could not start stream", "error"];
    };

    const scheduleExtend = (expiresAt: string) => {
      const ms = Math.max(15_000, new Date(expiresAt).getTime() - Date.now() - EXTEND_LEAD_MS);
      extendTimer = window.setTimeout(async () => {
        if (cancelled || !mediaSessionId) return;
        try {
          const r = await postStream<{ mediaSessionId: string; expiresAt: string }>(camera.id, { extend: mediaSessionId }, 0, () => cancelled);
          if (cancelled) return;
          mediaSessionId = r.mediaSessionId;
          scheduleExtend(r.expiresAt);
        } catch (e) {
          if (cancelled) return;
          teardown();
          const err = e as StreamError;
          scheduleRetry(...(err.code ? classify(err) : [err.message || "Stream expired", "error"] as Parameters<typeof scheduleRetry>));
        }
      }, ms);
    };

    const start = async () => {
      setStatus("connecting");
      setMessage(null);

      const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pc = conn;
      // SDM requires audio + video receivers and a data channel in the offer.
      conn.addTransceiver("audio", { direction: "recvonly" });
      conn.addTransceiver("video", { direction: "recvonly" });
      conn.createDataChannel("dataSendChannel");

      conn.ontrack = (ev) => {
        const v = videoRef.current;
        const stream = ev.streams[0];
        if (v && stream && v.srcObject !== stream) {
          v.srcObject = stream;
          void v.play().catch(() => {});
        }
      };
      conn.onconnectionstatechange = () => {
        if (cancelled || pc !== conn) return;
        const s = conn.connectionState;
        if (s === "connected") {
          window.clearTimeout(graceTimer);
          backoffRef.current = 0;
          setStatus("live");
          setMessage(null);
          // Watchdog: a "connected" peer whose video clock stops advancing is a dead stream.
          let lastTime = -1;
          let stalls = 0;
          window.clearInterval(stallTimer);
          stallTimer = window.setInterval(() => {
            const v = videoRef.current;
            if (cancelled || !v || pc !== conn) return;
            if (document.visibilityState !== "visible") return; // browsers throttle hidden tabs
            if (v.currentTime === lastTime) stalls++;
            else stalls = 0;
            lastTime = v.currentTime;
            if (stalls >= STALL_AFTER_CHECKS) {
              teardown();
              scheduleRetry("Video froze, reconnecting");
            }
          }, STALL_CHECK_MS);
        } else if (s === "failed" || s === "closed") {
          teardown();
          scheduleRetry("Connection lost");
        } else if (s === "disconnected") {
          // Often transient; give it a moment before rebuilding.
          graceTimer = window.setTimeout(() => {
            if (!cancelled && pc === conn && conn.connectionState === "disconnected") {
              teardown();
              scheduleRetry("Connection lost");
            }
          }, DISCONNECT_GRACE_MS);
        }
      };

      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      await waitForIceGathering(conn, ICE_GATHER_TIMEOUT_MS);
      if (cancelled || !conn.localDescription) return;

      const r = await postStream<{ answerSdp: string; mediaSessionId: string; expiresAt: string }>(
        camera.id,
        { offerSdp: conn.localDescription.sdp },
        1,
        () => cancelled,
      );
      if (cancelled) {
        stopSession(camera.id, r.mediaSessionId);
        return;
      }
      mediaSessionId = r.mediaSessionId;
      await conn.setRemoteDescription({ type: "answer", sdp: r.answerSdp });
      scheduleExtend(r.expiresAt);
    };

    start().catch((e: StreamError) => {
      if (cancelled) return;
      teardown();
      scheduleRetry(...classify(e));
    });

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener("pagehide", onUnload);
      teardown();
    };
  }, [camera.id, camera.webrtc, attempt, active]);

  // Network back: reconnect immediately if we are down. (Tab/viewport changes are handled by `active`.)
  useEffect(() => {
    if (!camera.webrtc) return;
    const onOnline = () => {
      if (status === "error" || status === "waking" || status === "throttled") retryNow();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [camera.webrtc, status, retryNow]);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    void v.play().catch(() => {});
  };

  const goFullscreen = () => {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const label = `Cam ${String(index + 1).padStart(2, "0")} · ${camera.name}`;
  // Pause is a property of the page/viewport, not of the stream, so derive it rather than store it.
  const shown: Status = camera.webrtc && !active ? "paused" : status;
  const shownMessage = shown === "paused" ? (pageActive ? "Off screen" : "Tab in background") : message;
  const statusMeta: Record<Status, { text: string; className: string }> = {
    live: { text: "Live", className: "text-ok" },
    connecting: { text: "Connecting", className: "text-accent" },
    waking: { text: "Waking", className: "text-warn" },
    throttled: { text: "Quota", className: "text-warn" },
    error: { text: "Offline", className: "text-danger" },
    unsupported: { text: "Unsupported", className: "text-muted" },
    paused: { text: "Paused", className: "text-muted" },
  };

  return (
    <section
      className={`corners relative flex flex-col border border-line bg-surface ${expanded ? "col-span-full order-first" : ""}`}
      aria-label={label}
    >
      <span className="corner-b" aria-hidden="true" />
      <header className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5">
        <h2 className="label truncate text-accent">{label}</h2>
        <div className="flex items-center gap-2">
          {shown === "live" ? <span className="status-dot" aria-hidden="true" /> : null}
          <span className={`label ${statusMeta[shown].className}`}>{statusMeta[shown].text}</span>
        </div>
      </header>

      <div
        ref={frameRef}
        className="group relative flex-1 cursor-pointer overflow-hidden bg-black"
        style={
          expanded
            ? { height: "clamp(320px, calc(100vh - 220px), 1400px)" }
            : { aspectRatio: shape === "wide" ? 16 / 9 : (aspect ?? savedAspect ?? 16 / 9) }
        }
        onClick={onToggleExpand}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) {
              const ratio = v.videoWidth / v.videoHeight;
              setAspect(ratio);
              if (Math.abs((savedAspect ?? 0) - ratio) > 0.01) setSavedAspect(ratio);
            }
          }}
          className={`absolute inset-0 h-full w-full transition-opacity ${shape === "wide" ? "object-cover" : "object-contain"} ${shown === "live" ? "opacity-100" : "opacity-0"}`}
        />

        {shown !== "live" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            {shown === "connecting" ? (
              <>
                <span className="label text-accent">Negotiating stream</span>
                <span className="label text-[10px] text-muted">Battery cameras can take a few seconds</span>
              </>
            ) : shown === "unsupported" ? (
              <>
                <span className="label text-muted">RTSP-only camera</span>
                <span className="label text-[10px] text-muted">WebRTC not offered by this device · not supported in v1</span>
              </>
            ) : shown === "paused" ? (
              <>
                <span className="label text-muted">Stream released</span>
                <span className="label text-[10px] text-muted">{shownMessage} · resumes automatically</span>
              </>
            ) : (
              <>
                <span className={`label ${shown === "error" ? "text-danger" : "text-warn"}`}>
                  {shown === "waking" ? "Camera asleep or offline" : shown === "throttled" ? "Google quota busy" : "No signal"}
                </span>
                {shownMessage ? <span className="label text-[10px] text-muted">{shownMessage}</span> : null}
                <span className="label text-[10px] text-muted">Retrying automatically</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    retryNow();
                  }}
                  className="label mt-2 border border-line px-3 py-1.5 text-foreground transition hover:border-line-strong hover:bg-surface-hover"
                >
                  Retry now
                </button>
              </>
            )}
          </div>
        ) : null}

        {camera.webrtc ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pointer-events-auto flex gap-1">
              <button type="button" onClick={toggleMute} className="label border border-line bg-background/80 px-2 py-1 text-muted hover:text-foreground" aria-pressed={!muted}>
                {muted ? "Unmute" : "Mute"}
              </button>
              <button type="button" onClick={onToggleExpand} className="label border border-line bg-background/80 px-2 py-1 text-muted hover:text-foreground">
                {expanded ? "Shrink" : "Expand"}
              </button>
            </div>
            <button type="button" onClick={goFullscreen} className="pointer-events-auto label border border-line bg-background/80 px-2 py-1 text-muted hover:text-foreground">
              Fullscreen
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
