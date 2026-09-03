@AGENTS.md

# Project notes

- Home camera dashboard. Build plan phases: see README.md and docs/google-setup.md.
- Auth lives in `src/lib/auth.ts` + `src/proxy.ts`. Keep `/login` and `/api/auth/login` the only public routes.
- All Google secrets are server-only. The client must only ever see short-lived access tokens and SDP answers.
- Dark theme is the default (wall-mounted screens). Design tokens are in `src/app/globals.css`.
