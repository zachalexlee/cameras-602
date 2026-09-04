"use client";

import { useState } from "react";
import { Panel } from "@/components/panel";
import type { RadioConfig } from "@/lib/radio";

export function RadioTile({ config }: { config: RadioConfig }) {
  const [active, setActive] = useState(0);
  const feed = config.feeds[Math.min(active, config.feeds.length - 1)];

  return (
    <Panel
      title="Radio"
      meta={<span>{config.directStreamUrl ? "Direct stream" : "Broadcastify"}</span>}
      bodyClassName="gap-3 px-4 py-3"
    >
      {config.feeds.length > 1 ? (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Radio feeds">
          {config.feeds.map((f, i) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`label border px-2.5 py-1 transition ${i === active ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-foreground"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="label text-foreground/90">{feed.label}</p>
      )}

      {config.directStreamUrl ? (
        <audio controls preload="none" src={config.directStreamUrl} className="w-full">
          Your browser does not support audio playback.
        </audio>
      ) : (
        // One iframe at a time so two scanners never talk over each other.
        <iframe
          key={feed.id}
          title={`${feed.label} live audio`}
          src={`https://www.broadcastify.com/webPlayer/${feed.id}`}
          className="h-[132px] w-full border-0 bg-black"
          allow="autoplay"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      )}

      <p className="label text-[10px] text-muted/60">
        {config.directStreamUrl ? "Premium direct stream" : "Press play in the player · audio via Broadcastify"}
        {" · "}
        <a href={config.directoryUrl} target="_blank" rel="noreferrer noopener" className="underline decoration-line underline-offset-2 hover:text-foreground">
          feed directory
        </a>
      </p>
    </Panel>
  );
}
