"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * localStorage-backed state that is hydration-safe (server snapshot is null)
 * and stays in sync across tabs on the same device.
 *
 * TODO(upgrade): swap the storage layer for Vercel KV / Upstash if cross-device
 * sync is ever wanted. The hook shape can stay the same.
 */
const listeners = new Set<() => void>();
const EVENT = "homeops:storage";

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = () => cb();
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, onStorage);
  };
}

export function useLocalStorageState<T>(key: string, fallback: T): [T | null, (next: T | ((prev: T) => T)) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => undefined, // server: not hydrated yet
  );

  const value = useMemo<T | null>(() => {
    if (raw === undefined) return null;
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }, [raw, fallback]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      let prev: T = fallback;
      try {
        const cur = window.localStorage.getItem(key);
        if (cur !== null) prev = JSON.parse(cur) as T;
      } catch {
        /* keep fallback */
      }
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        /* storage full or blocked: state simply won't persist */
      }
      emit();
      window.dispatchEvent(new Event(EVENT));
    },
    [key, fallback],
  );

  return [value, set];
}
