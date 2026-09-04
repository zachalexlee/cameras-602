"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Camera } from "@/lib/google";

type Status = "connecting" | "live" | "waking" | "error" | "unsupported";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const EXTEND_LEAD_MS = 60_000; // renew this long before SDM's expiresAt
const BACKOFF_BASE_MS = 3_000;
const BACKOFF_MAX_MS = 60_000;
const BACKOFF_MAX_LONG_MS = 5 * 60_000; // after repeated failures (e.g. dead battery)
const LONG_BACKOFF_AFTER = 6;
const RATE_LIMIT_MIN_DELAY_MS = 20_000; // SDM sandbox: ~10 calls/min per command
const STAGGER_MS = 350; // spread initial negotiations so 10 cameras don't hit the quota at once
const ICE_GATHER_TIMEOUT_MS = 2_000;
const DISCONNECT_GRACE_MS = 5_000;

type StreamError = Error & { code?: string };

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

async function postStream<T>(cameraId: string, body: Record<string, string>, keepalive = false): Promise<T> {
  const res = await fetch(`/api/cameras/${encodeURIComponent(cameraId)}/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) {
    const err: StreamError = new Error(data.error || `Request failed (${res.status})`);
    err.code = data.code;
    throw err;
  }
  return data;
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

  const retryNow = useCallback(() => {
    backoffRef.current = 0;
    setAttempt((a) => a + 1);
  }, []);

  // One WebRTC session per `attempt`. Cleanup tears it down; a retry bumps `attempt`.
  useEffect(() => {
    if (!camera.webrtc) return;
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let mediaSessionId: string | null = null;
    let extendTimer: number | undefined;
    let retryTimer: number | undefined;
    let graceTimer: number | undefined;

    const teardown = () => {
      window.clearTimeout(extendTimer);
      window.clearTimeout(graceTimer);
      if (pc) {
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
        pc = null;
      }
      if (mediaSessionId) {
        void postStream(camera.id, { stop: mediaSessionId }, true).catch(() => {});
        mediaSessionId = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const scheduleRetry = (why: string, asleep = false, rateLimited = false) => {
      if (cancelled) return;
      const n = backoffRef.current++;
      const cap = n >= LONG_BACKOFF_AFTER ? BACKOFF_MAX_LONG_MS : BACKOFF_MAX_MS;
      let delay = Math.min(cap, BACKOFF_BASE_MS * 2 ** n);
      if (rateLimited) delay = Math.max(delay, RATE_LIMIT_MIN_DELAY_MS);
      delay *= 0.8 + Math.random() * 0.4;
      setStatus(asleep ? "waking" : "error");
      setMessage(why);
      retryTimer = window.setTimeout(() => setAttempt((a) => a + 1), delay);
    };

    const scheduleExtend = (expiresAt: string) => {
      const ms = Math.max(15_000, new Date(expiresAt).getTime() - Date.now() - EXTEND_LEAD_MS);
      extendTimer = window.setTimeout(async () => {
        if (cancelled || !mediaSessionId) return;
        try {
          const r = await postStream<{ mediaSessionId: string; expiresAt: string }>(camera.id, { extend: mediaSessionId });
          if (cancelled) return;
          mediaSessionId = r.mediaSessionId;
          scheduleExtend(r.expiresAt);
        } catch (e) {
          teardown();
          scheduleRetry((e as Error).message || "Stream expired");
        }
      }, ms);
    };

    const start = async () => {
      setStatus("connecting");
      setMessage(null);

      // First attempt only: stagger by tile index so a big grid doesn't burst the SDM quota.
      if (attempt === 0 && index > 0) {
        await new Promise((r) => window.setTimeout(r, index * STAGGER_MS));
        if (cancelled) return;
      }

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

      const r = await postStream<{ answerSdp: string; mediaSessionId: string; expiresAt: string }>(camera.id, {
        offerSdp: conn.localDescription.sdp,
      });
      if (cancelled) {
        void postStream(camera.id, { stop: r.mediaSessionId }, true).catch(() => {});
        return;
      }
      mediaSessionId = r.mediaSessionId;
      await conn.setRemoteDescription({ type: "answer", sdp: r.answerSdp });
      scheduleExtend(r.expiresAt);
    };

    start().catch((e: StreamError) => {
      if (cancelled) return;
      teardown();
      const asleep = e.code === "FAILED_PRECONDITION" || /offline|asleep/i.test(e.message);
      const rateLimited = e.code === "RESOURCE_EXHAUSTED";
      scheduleRetry(asleep ? "Asleep, dead battery, or unplugged" : e.message || "Could not start stream", asleep, rateLimited);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      teardown();
    };
  }, [camera.id, camera.webrtc, attempt, index]);

  // Coming back to the tab or regaining network: reconnect immediately if we are down.
  useEffect(() => {
    if (!camera.webrtc) return;
    const onWake = () => {
      if (document.visibilityState === "visible" && (status === "error" || status === "waking")) retryNow();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
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
  const statusMeta: Record<Status, { text: string; className: string }> = {
    live: { text: "Live", className: "text-ok" },
    connecting: { text: "Connecting", className: "text-accent" },
    waking: { text: "Waking", className: "text-warn" },
    error: { text: "Offline", className: "text-danger" },
    unsupported: { text: "Unsupported", className: "text-muted" },
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
          {status === "live" ? <span className="status-dot" aria-hidden="true" /> : null}
          <span className={`label ${statusMeta[status].className}`}>{statusMeta[status].text}</span>
        </div>
      </header>

      <div
        ref={frameRef}
        className="group relative flex-1 cursor-pointer overflow-hidden bg-black"
        style={{ aspectRatio: shape === "wide" ? 16 / 9 : (aspect ?? 16 / 9), minHeight: expanded ? "60vh" : undefined }}
        onClick={onToggleExpand}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
          }}
          className={`absolute inset-0 h-full w-full transition-opacity ${shape === "wide" ? "object-cover" : "object-contain"} ${status === "live" ? "opacity-100" : "opacity-0"}`}
        />

        {status !== "live" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            {status === "connecting" ? (
              <>
                <span className="label text-accent">Negotiating stream</span>
                <span className="label text-[10px] text-muted/70">Battery cameras can take a few seconds</span>
              </>
            ) : status === "unsupported" ? (
              <>
                <span className="label text-muted">RTSP-only camera</span>
                <span className="label text-[10px] text-muted/70">WebRTC not offered by this device · not supported in v1</span>
              </>
            ) : (
              <>
                <span className={`label ${status === "waking" ? "text-warn" : "text-danger"}`}>
                  {status === "waking" ? "Camera asleep or offline" : "No signal"}
                </span>
                {message ? <span className="label text-[10px] text-muted/70">{message}</span> : null}
                <span className="label text-[10px] text-muted/70">Retrying automatically</span>
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
