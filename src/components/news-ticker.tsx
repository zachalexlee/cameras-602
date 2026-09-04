"use client";

import { useEffect, useRef, useState } from "react";
import type { NewsItem } from "@/lib/news";

const REFRESH_MS = 10 * 60 * 1000;
const SPEED_PX_PER_S = 70;
const MIN_DURATION_S = 30;

export function NewsTicker() {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [durationS, setDurationS] = useState(120);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/news", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { items?: NewsItem[] };
        if (cancelled) return;
        if (res.ok && data.items && data.items.length) {
          setItems(data.items);
          setFailed(false);
        } else {
          setFailed(true);
          setItems((prev) => prev ?? []);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          setItems((prev) => prev ?? []);
        }
      }
    };
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Speed is constant in px/s, so duration follows the rendered width of one copy.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || !items?.length) return;
    const measure = () => setDurationS(Math.max(MIN_DURATION_S, el.scrollWidth / 2 / SPEED_PX_PER_S));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items]);

  const hasItems = Boolean(items && items.length);

  return (
    <div className="flex items-stretch border-b border-line bg-elev/70" role="region" aria-label="News ticker">
      <div className="label flex shrink-0 items-center gap-2 border-r border-line px-3 py-2 text-accent sm:px-4">
        <span className="hidden sm:inline">News wire</span>
        <span className="sm:hidden">News</span>
        {failed ? <span className="text-warn" title="Some feeds failed">!</span> : null}
      </div>

      <div className="ticker-viewport relative min-w-0 flex-1 overflow-hidden">
        {hasItems ? (
          <div
            ref={trackRef}
            className="ticker-track"
            style={{ animationDuration: `${durationS}s` }}
          >
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
                {items!.map((item, i) => (
                  <a
                    key={`${copy}-${i}-${item.link}`}
                    href={item.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-3 px-5 py-2 text-sm text-foreground/90 hover:text-foreground"
                  >
                    <span className="label text-[10px] text-muted">{item.source}</span>
                    <span className="whitespace-nowrap">{item.title}</span>
                    <span className="ml-2 text-accent/60" aria-hidden="true">◆</span>
                  </a>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="label flex h-full items-center px-4 py-2 text-muted">
            {items === null ? "Fetching headlines" : "Headlines unavailable · retrying in a few minutes"}
          </div>
        )}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" aria-hidden="true" />
      </div>
    </div>
  );
}
