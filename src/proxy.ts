import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_RENEW_AFTER_SECONDS,
  SESSION_TTL_SECONDS,
  createSessionToken,
  readSessionToken,
  sessionCookieOptions,
} from "@/lib/auth";

/** Routes reachable without a session. Everything else needs the cookie. */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await readSessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === "/login" && session) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (session) {
    const res = NextResponse.next();
    // Sliding renewal: a screen that is used at least once a week stays signed in indefinitely.
    const ageSeconds = SESSION_TTL_SECONDS - (session.expiresAt - Date.now()) / 1000;
    if (ageSeconds > SESSION_RENEW_AFTER_SECONDS) {
      res.cookies.set(SESSION_COOKIE_NAME, await createSessionToken(), sessionCookieOptions());
    }
    return res;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  const next = `${pathname}${search}`;
  if (next !== "/") loginUrl.searchParams.set("next", next);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except Next's static assets, the favicon, and PWA assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|icons/).*)"],
};
