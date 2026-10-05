"use client";

import { useEffect, useState, type RefObject } from "react";

/** True while the tab is visible, and for `graceMs` after it is hidden (so a quick app switch doesn't drop streams). */
export function usePageActive(graceMs: number): boolean {
  const [active, setActive] = useState(true);
  useEffect(() => {
    let timer: number | undefined;
    const update = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") setActive(true);
      else timer = window.setTimeout(() => setActive(false), graceMs);
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [graceMs]);
  return active;
}

/** True while the element is (nearly) on screen, and for `graceMs` after it scrolls away. */
export function useInView(ref: RefObject<Element | null>, graceMs: number, margin = "200px"): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let timer: number | undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        window.clearTimeout(timer);
        if (entry.isIntersecting) setInView(true);
        else timer = window.setTimeout(() => setInView(false), graceMs);
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => {
      window.clearTimeout(timer);
      io.disconnect();
    };
  }, [ref, graceMs, margin]);
  return inView;
}
