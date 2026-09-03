"use client";

import { useSyncExternalStore } from "react";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

// Ticks once per second. The snapshot is whole seconds so React only re-renders when the display changes.
function subscribe(onTick: () => void) {
  const id = window.setInterval(onTick, 1000);
  return () => window.clearInterval(id);
}
const getSnapshot = () => Math.floor(Date.now() / 1000);
const getServerSnapshot = () => null;

/** Small local + UTC readout for the status bar. Renders fixed-width placeholders during SSR so hydration matches. */
export function StatusClock() {
  const seconds = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const now = seconds === null ? null : new Date(seconds * 1000);

  const local = now ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` : "--:--:--";
  const utc = now ? `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}Z` : "--:--Z";
  const date = now
    ? now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit", year: "numeric" }).toUpperCase()
    : "";

  return (
    <div className="flex items-baseline gap-3 font-mono tabular-nums">
      <span className="label hidden text-muted sm:inline">{date}</span>
      <span className="glow text-base font-medium text-foreground sm:text-lg">{local}</span>
      <span className="label text-muted">{utc}</span>
    </div>
  );
}
