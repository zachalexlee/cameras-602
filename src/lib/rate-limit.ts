/**
 * In-memory login rate limiter, keyed by client IP.
 *
 * Good enough for a single-user site on Vercel: each serverless instance keeps
 * its own counters, so the effective limit is per-instance rather than global.
 * Upgrade path: Vercel KV / Upstash if this ever needs to be exact.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILURES_PER_WINDOW = 5;
const MAX_TRACKED_IPS = 5000;

const failures = new Map<string, number[]>();

function prune(now: number) {
  for (const [ip, times] of failures) {
    const recent = times.filter((t) => now - t < WINDOW_MS);
    if (recent.length === 0) failures.delete(ip);
    else failures.set(ip, recent);
  }
}

export function checkLoginAllowed(
  ip: string,
  now: number = Date.now(),
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const recent = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length < MAX_FAILURES_PER_WINDOW) return { allowed: true };
  const oldest = Math.min(...recent);
  const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
  return { allowed: false, retryAfterSeconds };
}

export function recordLoginFailure(ip: string, now: number = Date.now()) {
  if (failures.size >= MAX_TRACKED_IPS) prune(now);
  const recent = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  failures.set(ip, recent);
}

export function clearLoginFailures(ip: string) {
  failures.delete(ip);
}
