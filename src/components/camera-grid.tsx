"use client";

import { useCallback, useEffect, useState } from "react";
import type { Camera } from "@/lib/google";
import { CameraTile } from "@/components/camera-tile";
import { Panel } from "@/components/panel";

const REFRESH_LIST_MS = 10 * 60 * 1000;

type LoadError = { message: string; code: string };

export function CameraGrid() {
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const res = await fetch(`/api/cameras${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { cameras?: Camera[]; error?: string; code?: string };
      if (!res.ok) {
        setError({ message: data.error ?? `Request failed (${res.status})`, code: data.code ?? "ERROR" });
        return;
      }
      setCameras(data.cameras ?? []);
      setError(null);
    } catch {
      setError({ message: "Could not reach the dashboard server.", code: "NETWORK" });
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const id = window.setInterval(() => void load(), REFRESH_LIST_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [load]);

  const count = cameras?.length ?? 0;

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="label text-muted">
          Live feeds · <span className="text-foreground">{cameras ? count : "--"}</span> {count === 1 ? "camera" : "cameras"}
        </h1>
        <button type="button" onClick={() => void load(true)} className="label text-muted transition hover:text-foreground">
          Refresh list
        </button>
      </div>

      {error && !cameras ? (
        <Panel title="Uplink" meta={<span className="text-danger">{error.code === "NOT_CONFIGURED" ? "Not linked" : "Error"}</span>} bodyClassName="gap-3 px-4 py-6">
          <p className="label text-foreground">{error.message}</p>
          {error.code === "NOT_CONFIGURED" ? (
            <p className="label text-[10px] text-muted/80">
              Finish the Google setup in docs/google-setup.md, then run /api/google/connect and redeploy.
            </p>
          ) : (
            <button type="button" onClick={() => void load(true)} className="label w-fit border border-line px-3 py-1.5 text-foreground hover:border-line-strong hover:bg-surface-hover">
              Try again
            </button>
          )}
        </Panel>
      ) : cameras === null ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Panel key={i} title={`Cam ${String(i + 1).padStart(2, "0")}`} meta="Loading" bodyClassName="aspect-video items-center justify-center">
              <span className="label text-muted">Fetching camera list</span>
            </Panel>
          ))}
        </section>
      ) : cameras.length === 0 ? (
        <Panel title="Uplink" meta={<span className="text-warn">No cameras</span>} bodyClassName="gap-3 px-4 py-6">
          <p className="label text-foreground">Google returned no cameras for this account.</p>
          <p className="label text-[10px] text-muted/80">Run /api/google/connect again and switch on each camera you want here.</p>
        </Panel>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cameras.map((cam, i) => (
            <CameraTile
              key={cam.id}
              camera={cam}
              index={i}
              expanded={expanded === cam.id}
              onToggleExpand={() => setExpanded((cur) => (cur === cam.id ? null : cam.id))}
            />
          ))}
        </section>
      )}

      {error && cameras ? (
        <p className="label text-[10px] text-warn">Camera list refresh failed: {error.message}. Showing the last known list.</p>
      ) : null}
    </>
  );
}
