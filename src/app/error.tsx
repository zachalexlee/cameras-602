"use client";

import { useEffect } from "react";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Wall screens have nobody to click: retry on their behalf after a minute.
  useEffect(() => {
    const id = window.setTimeout(reset, 60_000);
    return () => window.clearTimeout(id);
  }, [reset]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-6">
      <div className="corners relative w-full max-w-md border border-line bg-surface">
        <span className="corner-b" aria-hidden="true" />
        <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
          <span className="label text-danger">System fault</span>
          <span className="label text-muted">Auto-retry 60s</span>
        </div>
        <div className="flex flex-col gap-4 px-5 py-6">
          <p className="text-sm text-foreground/90">The dashboard hit an unexpected error while rendering.</p>
          <p className="label text-[10px] text-muted">{error.message || "Unknown error"}{error.digest ? ` · ${error.digest}` : ""}</p>
          <button type="button" onClick={reset} className="label w-fit border border-accent bg-accent/10 px-4 py-2 text-accent hover:bg-accent/20">
            Retry now
          </button>
        </div>
      </div>
    </main>
  );
}
