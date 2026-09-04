"use client";

import { useCallback, useEffect, useState } from "react";
import type { Camera } from "@/lib/google";
import { CameraTile, type TileShape } from "@/components/camera-tile";
import { Panel } from "@/components/panel";
import { useLocalStorageState } from "@/lib/use-local-storage";

const REFRESH_LIST_MS = 10 * 60 * 1000;
const MIN_COLS = 1;
const MAX_COLS = 6;

type LoadError = { message: string; code: string };
type GridPrefs = { cols: number | "auto"; shape: TileShape };
const DEFAULT_PREFS: GridPrefs = { cols: "auto", shape: "natural" };

export function CameraGrid() {
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [storedPrefs, setPrefs] = useLocalStorageState<GridPrefs>("homeops:grid:v1", DEFAULT_PREFS);
  const prefs = storedPrefs ?? DEFAULT_PREFS;

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
  const setCols = (cols: number | "auto") => setPrefs((p) => ({ ...p, cols }));
  const setShape = (shape: TileShape) => setPrefs((p) => ({ ...p, shape }));
  const step = (delta: number) => {
    const current = prefs.cols === "auto" ? 3 : prefs.cols;
    setCols(Math.min(MAX_COLS, Math.max(MIN_COLS, current + delta)));
  };

  const gridStyle =
    prefs.cols === "auto"
      ? undefined
      : ({ "--cols": prefs.cols, "--cols-mobile": Math.min(prefs.cols, 2) } as React.CSSProperties);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h1 className="label text-muted">
          Live feeds · <span className="text-foreground">{cameras ? count : "--"}</span> {count === 1 ? "camera" : "cameras"}
        </h1>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-1" role="group" aria-label="Tile size">
            <span className="label mr-1 text-muted">Tiles</span>
            <button type="button" onClick={() => setCols("auto")} aria-pressed={prefs.cols === "auto"} className={ctl(prefs.cols === "auto")}>
              Auto
            </button>
            <button type="button" onClick={() => step(-1)} aria-label="Larger tiles (fewer columns)" className={ctl(false)}>
              −
            </button>
            <span className="label w-6 text-center tabular-nums text-foreground" aria-live="polite">
              {prefs.cols === "auto" ? "A" : prefs.cols}
            </span>
            <button type="button" onClick={() => step(1)} aria-label="Smaller tiles (more columns)" className={ctl(false)}>
              +
            </button>
          </div>

          <div className="flex items-center gap-1" role="group" aria-label="Tile shape">
            <span className="label mr-1 text-muted">Shape</span>
            <button type="button" onClick={() => setShape("natural")} aria-pressed={prefs.shape === "natural"} className={ctl(prefs.shape === "natural")}>
              Natural
            </button>
            <button type="button" onClick={() => setShape("wide")} aria-pressed={prefs.shape === "wide"} className={ctl(prefs.shape === "wide")}>
              Wide
            </button>
          </div>

          <button type="button" onClick={() => void load(true)} className="label text-muted transition hover:text-foreground">
            Refresh list
          </button>
        </div>
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
        <section className={`camera-grid grid gap-3 ${prefs.cols === "auto" ? "camera-grid-auto" : "camera-grid-fixed"}`} style={gridStyle}>
          {cameras.map((cam, i) => (
            <CameraTile
              key={cam.id}
              camera={cam}
              index={i}
              shape={prefs.shape}
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

function ctl(active: boolean) {
  return `label border px-2 py-1 transition ${active ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:border-line-strong hover:text-foreground"}`;
}
