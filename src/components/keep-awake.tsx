"use client";

import { useEffect } from "react";

/**
 * Asks the browser to keep the screen on while the dashboard is visible
 * (Screen Wake Lock API). Silently does nothing where unsupported or denied.
 */
export function KeepAwake() {
  useEffect(() => {
    type WakeLockSentinelLike = { release(): Promise<void>; addEventListener(t: "release", cb: () => void): void };
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } };
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;

    const acquire = async () => {
      if (disposed || document.visibilityState !== "visible" || sentinel) return;
      try {
        sentinel = await nav.wakeLock!.request("screen");
        sentinel.addEventListener("release", () => {
          sentinel = null;
        });
      } catch {
        /* low battery, denied, or backgrounded: nothing to do */
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release().catch(() => {});
    };
  }, []);

  return null;
}
