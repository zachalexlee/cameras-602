# Home Camera Dashboard

A personal, password-protected web dashboard for Google Nest cameras, plus clock, weather, news ticker, notes and a Tacoma PD scanner. Next.js App Router, TypeScript, Tailwind. Hosted on Vercel.

Build plan: `docs/build-plan.md`. Google setup: `docs/google-setup.md`. Current status: **v1.0 — all four build-plan phases complete.** Cameras, news ticker, weather, notes, radio, and the hardening pass.

## Local dev

```bash
npm install
cp .env.example .env.local   # then fill in DASHBOARD_PASSWORD and AUTH_SECRET
npm run dev                  # http://localhost:3000
```

Generate `AUTH_SECRET` with `openssl rand -base64 32`.

## Deploy (Vercel)

1. Import this GitHub repo at https://vercel.com/new. Framework is auto-detected as Next.js.
2. Add the environment variables from `.env.example` under Project Settings → Environment Variables.
3. Every push to `main` deploys to production.

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `DASHBOARD_PASSWORD` | yes | login password |
| `AUTH_SECRET` | yes | HMAC key for the session cookie (random, 32+ bytes) |
| `SDM_PROJECT_ID` | Phase 2 | Google Device Access project id |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Phase 2 | OAuth web client |
| `GOOGLE_REFRESH_TOKEN` | Phase 2 | from the one-time linking flow (`docs/google-setup.md`) |
| `BROADCASTIFY_FEEDS` | optional | `Label\|feedId` pairs for the radio tile (default: Tacoma PD South, 15521) |
| `BROADCASTIFY_STREAM_URL` | optional | premium direct stream; otherwise the embed player is used |
| `NEWS_FEEDS` | optional | comma-separated RSS URLs overriding the defaults |

## Using the dashboard

- **Tiles** (top right of the camera section): `−` / `+` set 1–6 columns, `Auto` packs as many ~340px tiles as fit. **Shape**: `Natural` follows each camera's real aspect ratio (doorbells are tall); `Wide` forces 16:9 and crops. Both are remembered per device.
- Click a tile to enlarge it; hover for Unmute / Expand / Fullscreen.
- **Add to Home Screen** on an iPad or Android tablet for a full-screen kiosk. The page requests a screen wake lock so the display stays on while it is visible.
- **Camera list** refreshes every 10 min and when the network returns. Names come from the Google Home app; rename there, then "Refresh list".

## Reliability (Phase 4)

- Every module is wrapped in a crash guard (`TileBoundary`): a failing tile shows a fault panel and retries after 60s; the rest of the page keeps running. Route-level `error.tsx` / `global-error.tsx` do the same for the whole page.
- Camera tiles: exponential backoff (3s→60s, then 5 min after six straight failures), auto-extend before the SDM expiry, a frozen-frame watchdog (~30s without the video clock advancing forces a rebuild), staggered start-up, and reconnect on tab focus / network return.
- Sessions slide: any request older than 7 days into the 30-day cookie re-issues it, so a screen used at least weekly never lapses. If a session does lapse, the first 401 clears the cookie and sends the page to `/login`.
- Security headers: `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, `Permissions-Policy` denying camera/mic/geolocation (WebRTC here is receive-only), `X-Robots-Tag: noindex`.
- Nothing secret reaches the browser: the client bundle is checked for `GOOGLE_*`, `AUTH_SECRET`, `DASHBOARD_PASSWORD` and the SDM/token URLs. The browser only ever sees camera names/ids, SDP answers, headlines, and (by design) `BROADCASTIFY_STREAM_URL` if you set it.

## How auth works

- `src/proxy.ts` runs on every request except static assets. Only `/login` and `POST /api/auth/login` are public. Pages without a valid session redirect to `/login?next=…`; API routes get a 401.
- `POST /api/auth/login` compares the password in constant time, then sets an `HttpOnly; Secure; SameSite=Lax` cookie containing an HMAC-SHA256 signed token that expires after 30 days.
- Login attempts are rate limited per IP: 5 failures per 15 minutes (in-memory, per serverless instance).
- Rotate `AUTH_SECRET` to sign everyone out. Sessions renew themselves on use (see Reliability).

## Cameras and news

- `GET /api/cameras` lists camera-capable Nest devices (server-side SDM call, cached 5 min). `?refresh=1` bypasses the cache.
- `POST /api/cameras/[id]/stream` relays WebRTC negotiation: `{ offerSdp }` → answer, `{ extend: mediaSessionId }` before the ~5-minute expiry, `{ stop: mediaSessionId }` on teardown. Video flows browser ↔ Google directly; the server never sees it. The browser never receives a Google access token.
- Each `CameraTile` reconnects with exponential backoff (3s → 60s), renews the stream 60s before expiry, and retries immediately when the tab becomes visible or the network comes back.
- Grid controls (top-right of the camera section): Tiles Auto / 1–6 columns and Shape Natural / Wide, remembered per device. Wide forces 16:9 tiles and crops portrait doorbell feeds; Natural follows each stream's own shape.
- `GET /api/news` merges the RSS feeds in `src/lib/news.ts` (or `NEWS_FEEDS`), round-robin so no outlet dominates, cached 10 min. `?debug=1` shows which feeds responded.

- Weather is fetched in the browser from api.weather.gov for Tacoma (47.2529, -122.4443), refreshed every 15 minutes; the last good reading stays on screen if NWS is down.
- Notes persist in the browser's localStorage (per device). Upgrade path: Vercel KV.
- Radio embeds Broadcastify's web player per feed; set `BROADCASTIFY_STREAM_URL` for a premium direct stream.

To add or remove a feed, set `NEWS_FEEDS` in Vercel (format in `.env.example`) and redeploy. To add or remove a camera, re-run `/api/google/connect` and toggle it on Google's screen.

## Google setup

See `docs/google-setup.md` for the one-time Device Access + OAuth steps and the built-in `/api/google/connect` helper that prints your refresh token.
