import { NextResponse } from "next/server";
import { toBase64Url } from "@/lib/auth";
import { getRequestOrigin } from "@/lib/request";

/**
 * One-time account-linking helper (Phase 0).
 * Visiting /api/google/connect (while logged in to the dashboard) starts the
 * Google Device Access "Partner Connections" OAuth flow. Google sends the user
 * back to /api/google/callback, which prints the refresh token.
 */
export const OAUTH_STATE_COOKIE = "google_oauth_state";
export const SDM_SCOPE = "https://www.googleapis.com/auth/sdm.service";

export async function GET(req: Request) {
  const projectId = process.env.SDM_PROJECT_ID;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const missing = [!projectId && "SDM_PROJECT_ID", !clientId && "GOOGLE_CLIENT_ID"].filter(Boolean);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing env var(s): ${missing.join(", ")}. See docs/google-setup.md.` },
      { status: 500 },
    );
  }

  const state = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const redirectUri = `${getRequestOrigin(req)}/api/google/callback`;

  const authUrl = new URL(`https://nestservices.google.com/partnerconnections/${projectId}/auth`);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("client_id", clientId!);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SDM_SCOPE);
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 10 * 60,
  });
  return res;
}
