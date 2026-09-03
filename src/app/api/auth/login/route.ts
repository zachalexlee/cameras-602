import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  authConfigured,
  createSessionToken,
  passwordMatches,
  sessionCookieOptions,
} from "@/lib/auth";
import { checkLoginAllowed, clearLoginFailures, recordLoginFailure } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";

const MAX_PASSWORD_LENGTH = 1024;

export async function POST(req: Request) {
  const ip = getClientIp(req);

  const limit = checkLoginAllowed(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  if (!authConfigured()) {
    return NextResponse.json(
      { error: "Server is missing DASHBOARD_PASSWORD or AUTH_SECRET (16+ chars)." },
      { status: 500 },
    );
  }

  let password: unknown;
  try {
    const body = (await req.json()) as { password?: unknown };
    password = body?.password;
  } catch {
    password = undefined;
  }
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  if (!(await passwordMatches(password))) {
    recordLoginFailure(ip);
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }

  clearLoginFailures(ip);
  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
  return res;
}
