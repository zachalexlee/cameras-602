"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Camera } from "@/lib/google";

type Status = "connecting" | "live" | "waking" | "error" | "unsupported";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const EXTEND_LEAD_MS = 60_000; // renew this long before SDM's expiresAt
const BACKOFF_BASE_MS = 3_000;
const BACKOFF_MAX_MS = 60_000;
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

type Props = {
  camera: Camera;
  index: number;
  expanded: boolean;
  onToggleExpand: () => void;
};

export function CameraTile({ camera, index, expanded, onToggleExpand }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const backoffRef = useRef(0);
  const [status, setStatus] = useState<Status>(camera.webrtc ? "connecting" : "unsupported");
  const [message, setMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [attempt, setAttempt] = useState(0);

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

    const scheduleRetry = (why: string, asleep = false) => {
      if (cancelled) return;
      const n = backoffRef.current++;
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** n) * (0.8 + Math.random() * 0.4);
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
      scheduleRetry(e.message || "Could not start stream", asleep);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      teardown();
    };
  }, [camera.id, camera.webrtc, attempt]);

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
      <header className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <h2 className="label truncate text-accent">{label}</h2>
        <div className="flex items-center gap-2">
          {status === "live" ? <span className="status-dot" aria-hidden="true" /> : null}
          <span className={`label ${statusMeta[status].className}`}>{statusMeta[status].text}</span>
        </div>
      </header>

      <div ref={frameRef} className="group relative aspect-video cursor-pointer bg-black" onClick={onToggleExpand}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`h-full w-full object-contain transition-opacity ${status === "live" ? "opacity-100" : "opacity-0"}`}
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
