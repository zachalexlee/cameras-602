# Home Camera Dashboard

A personal, password-protected web dashboard for Google Nest cameras, plus clock, weather, news ticker, notes and a Tacoma PD scanner. Next.js App Router, TypeScript, Tailwind. Hosted on Vercel.

Build plan: `docs/build-plan.md`. Google setup: `docs/google-setup.md`. Current status: **Phase 1 (skeleton + auth)**.

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
| `BROADCASTIFY_STREAM_URL` | optional | premium direct stream; otherwise the embed player is used |
| `NEWS_FEEDS` | optional | comma-separated RSS URLs overriding the defaults |

## How auth works

- `src/proxy.ts` runs on every request except static assets. Only `/login` and `POST /api/auth/login` are public. Pages without a valid session redirect to `/login?next=…`; API routes get a 401.
- `POST /api/auth/login` compares the password in constant time, then sets an `HttpOnly; Secure; SameSite=Lax` cookie containing an HMAC-SHA256 signed token that expires after 30 days.
- Login attempts are rate limited per IP: 5 failures per 15 minutes (in-memory, per serverless instance).
- Rotate `AUTH_SECRET` to sign everyone out.

## Google setup

See `docs/google-setup.md` for the one-time Device Access + OAuth steps and the built-in `/api/google/connect` helper that prints your refresh token.
