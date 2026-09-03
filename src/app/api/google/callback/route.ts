import { NextResponse, type NextRequest } from "next/server";
import { getRequestOrigin } from "@/lib/request";
import { OAUTH_STATE_COOKIE } from "../connect/route";

/**
 * Second half of the one-time account-linking helper (Phase 0).
 * Exchanges the authorization code for tokens, prints the refresh token, and
 * lists the linked devices so you can confirm the cameras are visible.
 *
 * This page is gated by the dashboard password (see src/proxy.ts). The refresh
 * token is shown exactly once, here, so you can copy it into your env vars.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;background:#09090b;color:#fafafa;max-width:860px;margin:3rem auto;padding:0 1.5rem;line-height:1.5}
  code,pre{font-family:ui-monospace,Menlo,monospace;background:#18181b;border:1px solid #27272a;border-radius:6px}
  code{padding:.1rem .35rem} pre{padding:1rem;overflow:auto;white-space:pre-wrap;word-break:break-all}
  .muted{color:#a1a1aa} .err{color:#f87171} a{color:#38bdf8}
</style></head><body>${body}</body></html>`;
  const res = new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/api/google", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  const oauthError = params.get("error");
  if (oauthError) {
    return page("Google linking failed", `<h1 class="err">Google returned an error</h1><pre>${escapeHtml(oauthError)}</pre>
      <p><a href="/api/google/connect">Try again</a></p>`, 400);
  }

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return page("Google linking failed", `<h1 class="err">Missing or mismatched OAuth state</h1>
      <p class="muted">Start the flow again from <a href="/api/google/connect">/api/google/connect</a> in the same browser.</p>`, 400);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const projectId = process.env.SDM_PROJECT_ID;
  if (!clientId || !clientSecret || !projectId) {
    return page("Google linking failed", `<h1 class="err">Missing env vars</h1>
      <p>Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>SDM_PROJECT_ID</code>, then retry.</p>`, 500);
  }

  const redirectUri = `${getRequestOrigin(req)}/api/google/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    return page("Google linking failed", `<h1 class="err">Token exchange failed (${tokenRes.status})</h1>
      <pre>${escapeHtml(JSON.stringify(tokenJson, null, 2))}</pre>
      <p class="muted">Check that <code>${escapeHtml(redirectUri)}</code> is listed as an authorized redirect URI on the OAuth client.</p>`, 502);
  }

  // Verify the link by listing devices with the fresh access token.
  const devicesRes = await fetch(
    `https://smartdevicemanagement.googleapis.com/v1/enterprises/${encodeURIComponent(projectId)}/devices`,
    { headers: { Authorization: `Bearer ${tokenJson.access_token}` }, cache: "no-store" },
  );
  const devicesJson = (await devicesRes.json().catch(() => ({}))) as {
    devices?: Array<{ name?: string; type?: string; traits?: Record<string, { customName?: string }> }>;
  };
  const devices = devicesJson.devices ?? [];
  const deviceRows = devices
    .map((d) => {
      const id = d.name?.split("/").pop() ?? "?";
      const label = d.traits?.["sdm.devices.traits.Info"]?.customName || "(no name)";
      return `<li><strong>${escapeHtml(label)}</strong> <span class="muted">${escapeHtml(d.type ?? "")}</span><br><code>${escapeHtml(id)}</code></li>`;
    })
    .join("");

  const refreshSection = tokenJson.refresh_token
    ? `<h2>1. Save this refresh token</h2>
       <p>Add it to <code>.env.local</code> and to Vercel → Project Settings → Environment Variables:</p>
       <pre>GOOGLE_REFRESH_TOKEN=${escapeHtml(tokenJson.refresh_token)}</pre>
       <p class="muted">It is shown only once. Anyone with this token can view your cameras — keep it out of git.</p>`
    : `<h2 class="err">No refresh token returned</h2>
       <p>Google only issues a refresh token on the first consent. Revoke the app at
       <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>
       and run <a href="/api/google/connect">/api/google/connect</a> again.</p>`;

  const devicesSection = devicesRes.ok
    ? `<h2>2. Linked devices (${devices.length})</h2>${devices.length ? `<ul>${deviceRows}</ul>` : `<p class="muted">No devices returned. Make sure you ticked the cameras on Google's consent screen.</p>`}`
    : `<h2 class="err">2. Device list failed (${devicesRes.status})</h2><pre>${escapeHtml(JSON.stringify(devicesJson, null, 2))}</pre>`;

  return page(
    "Google linked",
    `<h1>Google account linked</h1>${refreshSection}${devicesSection}
     <h2>3. Redeploy</h2><p>After saving the env var, redeploy on Vercel (or restart <code>next dev</code>) and open <a href="/">the dashboard</a>.</p>`,
  );
}
