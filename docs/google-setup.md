# Google Device Access setup (Phase 0)

One-time manual steps to let the dashboard talk to your Nest cameras. Budget about 20 minutes plus the $5 Device Access fee. At the end you will have five values for your env vars:

| Var | Where it comes from |
|---|---|
| `SDM_PROJECT_ID` | Device Access Console (step 1) |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth client (step 2) |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client (step 2) |
| `GOOGLE_REFRESH_TOKEN` | the account-linking flow (step 3) |
| `DASHBOARD_PASSWORD`, `AUTH_SECRET` | you pick these (Phase 1) |

Do the steps in order. Steps 1 and 2 reference each other, so keep both tabs open.

## 1. Register for Device Access and create a Device Access project

1. Go to https://developers.google.com/nest/device-access and click **Go to the Device Access Console**.
2. Accept the Sandbox Terms of Service and pay the one-time **US$5** fee with the Google account that owns the Nest cameras (the one you use in the Google Home app).
3. In the console (https://console.nest.google.com/device-access), click **Create project**.
   - Name it anything, e.g. `home-dashboard`.
   - When asked for an **OAuth client ID**, choose **Skip for now** if you haven't done step 2 yet. You can paste it in later.
   - **Enable events**: leave off. This dashboard is view-only and does not use Pub/Sub.
4. Copy the **Project ID** shown at the top of the project page. It is a UUID like `8a2b6f10-....`

   → `SDM_PROJECT_ID`

## 2. Create a Google Cloud project, enable the SDM API, create an OAuth web client

1. Open https://console.cloud.google.com/projectcreate and create a project (any name). Make sure it is selected in the top bar afterwards.
2. Enable the **Smart Device Management API**:
   https://console.cloud.google.com/apis/library/smartdevicemanagement.googleapis.com → **Enable**.
3. Configure the OAuth consent screen (Google requires this before creating a client):
   https://console.cloud.google.com/auth/overview
   - User type: **External**.
   - App name / support email / developer email: anything valid.
   - Scopes: none needed here (the scope is requested at runtime).
   - **Audience → Test users**: add the Google account that owns the cameras. While the app is in *Testing* status only test users can authorize it. That is fine for a single-user dashboard. (Note: refresh tokens for apps in Testing status expire after 7 days **unless** the scope is a Google-internal one like SDM; in practice SDM refresh tokens from a Testing app keep working. If yours stops, re-run step 3.)
4. Create the OAuth client: https://console.cloud.google.com/auth/clients → **Create client**.
   - Application type: **Web application**.
   - Name: `home-dashboard`.
   - **Authorized redirect URIs** — add both:
     - `http://localhost:3000/api/google/callback`
     - `https://<your-vercel-domain>/api/google/callback` (e.g. `https://cameras-602.vercel.app/api/google/callback`). Add your custom domain too if you use one.
   - Click **Create**, then copy the **Client ID** and **Client secret**.

   → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
5. Back in the **Device Access Console** (step 1), open your project → **OAuth client ID** → paste the Client ID from 2.4. Save.

## 3. Link your Google account and get the refresh token

The repo has a helper that runs the Partner Connections OAuth flow for you, so no curl is needed. It is protected by the dashboard password.

1. Put the values so far in `.env.local` (locally) or in Vercel env vars:

   ```
   DASHBOARD_PASSWORD=...
   AUTH_SECRET=...            # openssl rand -base64 32
   SDM_PROJECT_ID=...
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

2. Start the app (`npm run dev`, or use the deployed Vercel URL) and log in to the dashboard.
3. Visit **`/api/google/connect`** on that same origin, e.g. `http://localhost:3000/api/google/connect`.
4. Google shows the **Partner Connections** screen: pick the home, tick every camera you want on the dashboard, and allow the `sdm.service` scope. You may see an "unverified app" warning because the app is in Testing status. Click **Continue**.
5. You land on `/api/google/callback`, which shows:
   - `GOOGLE_REFRESH_TOKEN=...` — copy it into `.env.local` and Vercel. It is shown once.
   - The list of linked devices with their names and IDs. This is the verification from step 4 below, done for you.
6. Restart `next dev` / redeploy so the new env var is picked up.

If the page says "No refresh token returned", Google already granted one earlier. Revoke the app at https://myaccount.google.com/permissions and run `/api/google/connect` again. `prompt=consent` is already set, so this is rare.

## 4. Verify manually (optional)

The callback page already lists your devices. To double-check from a terminal:

```bash
# 1. Get an access token from the refresh token
curl -s -X POST https://oauth2.googleapis.com/token \
  -d client_id="$GOOGLE_CLIENT_ID" \
  -d client_secret="$GOOGLE_CLIENT_SECRET" \
  -d refresh_token="$GOOGLE_REFRESH_TOKEN" \
  -d grant_type=refresh_token
# 2. List devices with it
curl -s "https://smartdevicemanagement.googleapis.com/v1/enterprises/$SDM_PROJECT_ID/devices" \
  -H "Authorization: Bearer <access_token>"
```

You should see one entry per camera, type `sdm.devices.types.CAMERA` or `sdm.devices.types.DOORBELL`. Cameras whose `sdm.devices.traits.CameraLiveStream` trait lists `WEB_RTC` under `supportedProtocols` will stream in the dashboard. Ones that only list `RTSP` will show an "unsupported camera" tile (see build plan, v1 non-goal).

## Notes and gotchas

- **Sandbox limits**: a sandbox Device Access project is limited to a few concurrent stream sessions and 10 QPM per API method. Enough for one household. Commercial approval is not needed.
- **Battery cameras** sleep; the first stream request wakes them and can take a few seconds. The dashboard retries.
- **Re-linking**: if you add a new camera later, run `/api/google/connect` again and tick it. The refresh token may stay the same; if a new one is printed, update the env var.
- **Secrets**: never commit `.env.local`. The client only ever receives short-lived access tokens and SDP answers; the refresh token and client secret stay server-side.
