"use client";

/**
 * fetch() for dashboard APIs. If the session has lapsed (401), clear the
 * cookie and send the whole page to /login instead of leaving dead tiles on a
 * wall screen. Clearing first guarantees the login page renders (the proxy
 * bounces signed-in visitors away from /login), so this can never loop.
 */
let redirecting = false;

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && !window.location.pathname.startsWith("/login")) {
    if (!redirecting) {
      redirecting = true;
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      // Full navigation on purpose: the proxy must see the cleared cookie.
      window.location.replace("/login");
    }
    await new Promise(() => {}); // the navigation replaces the page
  }
  return res;
}
