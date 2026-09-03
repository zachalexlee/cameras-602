# Build Plan: Home Camera Dashboard

A personal, password-protected web dashboard showing all of my Google Nest cameras live on one screen, plus a news ticker, weather, clock, notes, and a Tacoma police radio player. Hosted on Vercel from a GitHub repo.

This is a spec for Claude Code to implement. Work through the phases in order — each phase ends in a deployable, testable state.

---

## 1. Goals and non-goals

**Goals**

- All Nest cameras live at once in a responsive grid, low-latency (WebRTC), on any of my devices via a normal URL.
- Single-user: just me, protected by a simple password.
- Extra tiles: clock/date header, Tacoma weather, notes/to-do scratchpad, scrolling top-news ticker, Tacoma PD scanner audio player.
- Deployed on Vercel via push-to-deploy from GitHub.

**Non-goals (v1)**

- No recording, motion events, or history (view-only live streams).
- No multi-user accounts.
- No home server component — everything runs on Vercel + Google's cloud (Nest cams are cloud cameras; the browser negotiates WebRTC with Google's servers directly).

## 2. Stack

- **Next.js (App Router, latest stable), TypeScript, Tailwind CSS.**
- No database. Notes tile persists to `localStorage` in v1.
- Deploy target: Vercel (framework auto-detected). Repo on GitHub, `main` = production.

## 3. Architecture overview

```
Browser (dashboard page)
  ├─ WebRTC peer connection per camera ──────► Google SDM cloud (video never touches our server)
  ├─ /api/auth/*        password login → HttpOnly signed session cookie
  ├─ /api/google/token  server-side OAuth refresh → short-lived access token for the page
  ├─ /api/cameras       proxied SDM device list
  ├─ /api/cameras/[id]/stream   proxied SDM GenerateWebRtcStream / ExtendWebRtcStream
  ├─ /api/news          server-side RSS fetch + cache → ticker items
  └─ Weather fetched client-side from api.weather.gov (open CORS, no key)
```

All Google secrets live only in server-side env vars. The client only ever sees short-lived access tokens / SDP answers.

## 4. Phase 0 — Google Device Access setup (manual, do first)

These are human steps; Claude Code should write a `docs/google-setup.md` walking through them with exact URLs, then I'll do them and fill in env vars.

1. Register for **Google Device Access** (one-time $5): https://developers.google.com/nest/device-access — creates a **Device Access project** → note `SDM_PROJECT_ID`.
2. In Google Cloud Console: create a project, enable the **Smart Device Management API**, create an **OAuth 2.0 Web client** → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Add `https://<my-vercel-domain>/api/google/callback` and `http://localhost:3000/api/google/callback` as redirect URIs.
3. Run the Partner Connections (account-linking) OAuth flow once with scope `https://www.googleapis.com/auth/sdm.service`, authorize the cameras, exchange the code for a **refresh token** → `GOOGLE_REFRESH_TOKEN`.
   - Build a tiny helper route `/api/google/connect` + `/api/google/callback` that runs this flow and prints the refresh token, so no curl gymnastics are needed. Keep the routes behind the dashboard password.
4. Verify with a call to `GET https://smartdevicemanagement.googleapis.com/v1/enterprises/{SDM_PROJECT_ID}/devices` — should list the cameras.

**Nest API facts to build around:**

- Camera streams for current-gen (battery/wired) cams use `sdm.devices.commands.CameraLiveStream.GenerateWebRtcStream`: client creates an SDP **offer** (with a data channel — required), server relays it to SDM, SDM returns the **answer** + `mediaSessionId` + `expiresAt`.
- Streams expire (~5 min). Call `ExtendWebRtcStream` with the `mediaSessionId` before expiry; re-generate on failure.
- Battery cameras sleep; streams start on demand and may take a couple seconds to wake. Handle "camera offline/asleep" gracefully with a retry button on the tile.
- Older cams may return RTSP instead of WebRTC (`GenerateRtspStream`); v1 can show "unsupported camera" on those tiles — note it, don't build an RTSP relay.

## 5. Phase 1 — Skeleton + auth

- Scaffold Next.js app, Tailwind, dark theme default (this will live on wall-mounted/always-on screens; light theme optional).
- `proxy.ts` (or `middleware.ts` on older Next) gating every route except `/login` and `/api/auth/login`:
  - `POST /api/auth/login` checks password against `DASHBOARD_PASSWORD` env var (constant-time compare), sets an **HttpOnly, Secure, SameSite=Lax** cookie containing an HMAC-signed token (`AUTH_SECRET` env var) with a 30-day expiry.
  - Simple rate limit on login attempts (in-memory per-IP counter is fine on Vercel for v1).
- `/login`: minimal centered password form.
- Deploy checkpoint: site live on Vercel, password gate works.

## 6. Phase 2 — Camera grid (the core)

- `/api/google/token`: exchanges `GOOGLE_REFRESH_TOKEN` for an access token, caches it server-side until expiry, returns it to the (authenticated) page.
- `/api/cameras`: lists SDM devices, returns id + display name + type for camera-capable devices.
- `/api/cameras/[id]/stream`: POST body `{ offerSdp }` → calls `GenerateWebRtcStream`, returns `{ answerSdp, mediaSessionId, expiresAt }`. Also accepts `{ extend: mediaSessionId }` → `ExtendWebRtcStream`.
- Client `CameraTile` component:
  - Creates `RTCPeerConnection` (Google's SDM works without custom TURN; include a public STUN server), adds recvonly audio/video transceivers **and a data channel**, sends offer to our API, applies answer, renders into `<video>` (muted + `playsinline` by default, tap to unmute).
  - Auto-extends the stream on a timer from `expiresAt`; tears down and re-creates on error, with exponential backoff.
  - Overlay: camera name, live indicator, wake/retry state for sleeping battery cams, fullscreen button.
- `CameraGrid`: CSS grid, auto-fits 1–2 columns on phone, 2–3 on desktop; clicking a tile expands it.
- Deploy checkpoint: all cameras streaming live on the deployed site.

## 7. Phase 3 — Dashboard tiles

- **Header**: large clock + date (client-rendered, ticking), page title.
- **News ticker** (top of page, under/over header): `/api/news` fetches 2–3 RSS feeds server-side — AP Top News, NPR News (`https://feeds.npr.org/1001/rss.xml`), and The News Tribune / KING 5 local feed if available — merges + dedupes headlines, caches 10 min (`revalidate`), returns `[{title, link, source}]`. Client renders a smooth CSS-animation marquee; pause on hover; headlines link out in a new tab. Feed URLs configurable via env/JSON so they're easy to swap.
- **Weather tile**: client-side to `api.weather.gov` for Tacoma (47.2529, -122.4443): current conditions + today/tonight forecast + next few periods. NWS requires a descriptive `User-Agent` when called server-side; from the browser it works as-is. Cache in-page, refresh every 15 min.
- **Notes/to-do tile**: simple checklist + free-text scratchpad persisted to `localStorage`. (Leave a TODO comment: upgrade path is Vercel KV if I ever want cross-device sync.)
- **Police radio tile**: Tacoma PD dispatch via Broadcastify.
  - v1: embed Broadcastify's own web player for the two Tacoma feeds — Tacoma Police North and Tacoma Police South (feed directory: https://www.broadcastify.com/listen/ctid/2984 — Tacoma South is feed 15521; confirm North's id from the directory). Use their official player/embed URL per feed page; do **not** hotlink raw stream URLs, which their ToS forbids for free accounts.
  - Leave a clearly-marked config spot `BROADCASTIFY_STREAM_URL` (optional env): if I find my premium API key later, swap in the direct authenticated stream and render a native `<audio>` player instead.
- Deploy checkpoint: full dashboard live.

## 8. Phase 4 — Polish + hardening

- Error states for every tile (camera asleep, news fetch failed, weather down) — a tile failing must never blank the page.
- Page stays healthy when left open for days: reconnect logic on `visibilitychange`/network change; ticker and clock don't leak timers.
- Verify no secret reaches the client (check the network tab: only short-lived access tokens and SDP).
- Lighthouse pass on mobile; the grid should look good on a phone, a laptop, and a TV-sized screen.
- `README.md`: setup, env vars, local dev (`vercel dev` or `next dev`), how to add/remove a camera or feed.

## 9. Environment variables

| Var | Purpose |
|---|---|
| `DASHBOARD_PASSWORD` | login password |
| `AUTH_SECRET` | HMAC key for session cookie (random 32+ bytes) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth web client |
| `GOOGLE_REFRESH_TOKEN` | from one-time account-linking flow |
| `SDM_PROJECT_ID` | Device Access project id |
| `BROADCASTIFY_STREAM_URL` | optional, premium direct stream (else use embed player) |
| `NEWS_FEEDS` | optional comma-separated RSS URL override |

Set locally in `.env.local` (gitignored) and in Vercel Project Settings → Environment Variables.

## 10. Acceptance criteria

1. Visiting the production URL logged-out shows only the login page; wrong passwords are rejected and rate-limited.
2. After login, every current-gen Nest camera renders live video within ~5 s (battery cams may take a wake-up retry), and streams stay up past the 5-minute SDM expiry without user action.
3. Ticker scrolls current headlines; weather shows current Tacoma conditions; clock ticks; notes survive a reload; radio tile plays Tacoma PD dispatch audio.
4. No Google secret or refresh token appears in any client-visible response.
5. `git push` to `main` deploys to Vercel automatically.
