"use client";

import { useSyncExternalStore } from "react";

/**
 * One shared budget for every Google camera command this browser tab sends
 * (start, renew, stop). Google's Device Access sandbox allows roughly ten
 * camera commands per minute per project, and ten tiles each acting alone
 * trip it constantly. This module:
 *   - spaces requests out and caps them per sliding minute,
 *   - serves renewals before new starts (a renewal keeps a live picture),
 *   - pauses *everything* when Google answers 429, so one tile's limit never
 *     cascades into nine more.
 */

export type Priority = 0 | 1 | 2; // 0 = extend, 1 = generate, 2 = stop

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8; // headroom under Google's ~10/min
const MIN_SPACING_MS = 1_500;
const DEFAULT_PAUSE_MS = 30_000;
const MAX_QUEUED_STOPS = 3; // stale sessions expire on their own; don't spend budget on a backlog of stops

type Job = { priority: Priority; seq: number; run: () => void; cancel: (reason: Error) => void };

const sent: number[] = [];
const queue: Job[] = [];
let seq = 0;
let pausedUntil = 0;
let timer: number | undefined;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function nextSlotIn(now: number): number {
  const recent = sent.filter((t) => now - t < WINDOW_MS);
  sent.length = 0;
  sent.push(...recent);
  const sinceLast = recent.length ? now - recent[recent.length - 1] : Infinity;
  let wait = Math.max(0, MIN_SPACING_MS - sinceLast, pausedUntil - now);
  if (recent.length >= MAX_PER_WINDOW) wait = Math.max(wait, recent[0] + WINDOW_MS - now);
  return wait;
}

function pump() {
  window.clearTimeout(timer);
  timer = undefined;
  if (queue.length === 0) return;
  const now = Date.now();
  const wait = nextSlotIn(now);
  if (wait > 0) {
    timer = window.setTimeout(pump, wait + 5);
    return;
  }
  queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  const job = queue.shift()!;
  sent.push(now);
  job.run();
  notify();
  if (queue.length) timer = window.setTimeout(pump, MIN_SPACING_MS);
}

/** Wait for a slot, then run `fn`. Rejects with the given signal if `cancelled()` turns true first. */
export function schedule<T>(priority: Priority, fn: () => Promise<T>, cancelled: () => boolean = () => false): Promise<T> {
  if (priority === 2 && queue.filter((j) => j.priority === 2).length >= MAX_QUEUED_STOPS) {
    return Promise.reject(new Error("stop dropped: budget busy"));
  }
  return new Promise<T>((resolve, reject) => {
    const job: Job = {
      priority,
      seq: seq++,
      run: () => {
        if (cancelled()) return reject(new Error("cancelled"));
        fn().then(resolve, reject);
      },
      cancel: reject,
    };
    queue.push(job);
    notify();
    pump();
  });
}

/** Google said slow down: hold every queued command for `ms` (or a sane default). */
export function pauseFor(ms?: number) {
  const until = Date.now() + Math.max(5_000, Math.min(5 * 60_000, ms ?? DEFAULT_PAUSE_MS));
  if (until > pausedUntil) {
    pausedUntil = until;
    notify();
    pump();
  }
}

export type BudgetState = { pausedForSeconds: number; queued: number; sentLastMinute: number };
let snapshot: BudgetState = { pausedForSeconds: 0, queued: 0, sentLastMinute: 0 };
function getSnapshot(): BudgetState {
  const now = Date.now();
  const next: BudgetState = {
    pausedForSeconds: pausedUntil > now ? Math.ceil((pausedUntil - now) / 1000) : 0,
    queued: queue.length,
    sentLastMinute: sent.filter((t) => now - t < WINDOW_MS).length,
  };
  if (next.pausedForSeconds !== snapshot.pausedForSeconds || next.queued !== snapshot.queued || next.sentLastMinute !== snapshot.sentLastMinute) snapshot = next;
  return snapshot;
}
const serverSnapshot: BudgetState = { pausedForSeconds: 0, queued: 0, sentLastMinute: 0 };
function subscribe(cb: () => void) {
  listeners.add(cb);
  const tick = window.setInterval(cb, 1_000); // let the "paused Ns" readout count down
  return () => {
    listeners.delete(cb);
    window.clearInterval(tick);
  };
}
export function useStreamBudget(): BudgetState {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}
