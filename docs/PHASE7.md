# Phase 7 — Launch: Docker, CI, deployment, backups, monitoring

| Step | What | Status |
|---|---|---|
| 7.1 | Production readiness: one-origin web app hosting with a strict CSP, liveness/readiness health checks, release version, production config guards, prebuilt Motion bundle | ✅ Built and verified locally |
| 7.2 | Docker image (API + worker roles), production Compose stack (Caddy HTTPS, MongoDB replica set, worker, backups) | ✅ Written. Image build runs in CI (Docker isn't installed on the dev PC) |
| 7.3 | GitHub Actions CI: typecheck, build, 207 tests on MongoDB, dependency audit, Docker build + smoke test | ✅ Written. First run happens on the next push |
| 7.4 | Backups (nightly dumps, 14-day retention, restore steps) and monitoring (health endpoints, uptime monitor, JSON logs, admin warnings) | ✅ Built and documented in [DEPLOY.md](DEPLOY.md) |
| 7.5 | Go live: hosting account, domain/DNS, production secrets, R2, SMTP on own domain, Razorpay live keys, first super admin | ⏳ Needs your accounts and choices |

## What changed in the code
- `server/src/services/web/spa.ts`: when `CLIENT_DIST_DIR` is set, the API serves the built web app outside `/api`.
  - Hashed assets are cached for a year; `index.html` is never cached.
  - CSP: only our scripts, the inline theme script by sha256 hash, Razorpay Checkout, Google Fonts, and storage origins derived from the R2/S3 config (extra ones via `MEDIA_ORIGINS`). The page can't be framed.
- `GET /api/health/live` (liveness) next to `GET /api/health` (readiness, now with `version` from `APP_VERSION`).
- Production refuses a non-https `APP_URL`.
- `npm run motion:prepare -- <dir>` prebuilds the Remotion bundle and downloads headless Chrome.
  - Measured locally: a render from the prebuilt bundle took 2.3 s, with no ~20 s webpack step.
- Tests use `TEST_MONGODB_URI` directly when set (CI's MongoDB service).
- `.gitattributes` keeps shell scripts, the Dockerfile and YAML in LF, so a Windows checkout still runs in Linux containers.

## Verified
- The web app served by the API with the CSP on was checked in the browser: projects, video playback, the Motion preview player, Billing and Admin all show no CSP violations.
  - This check caught one problem and fixed it: the Remotion player's built-in silent audio needs `media-src data:`.
- 207/207 server tests pass, and both client and server typecheck cleanly.

## Not verified yet
- `docker build` and the Compose stack: nothing ran locally, so the first CI run is the first real build.
- Razorpay Checkout under the CSP (no keys yet), and Caddy HTTPS on a real domain.

## Decisions needed from you (7.5)
1. **Hosting:** a single VPS with Docker Compose (cheapest and simplest), or managed containers (Railway/Render/Fly) + Atlas + R2 (less ops, scales more easily). Recommendation: start with **Atlas + R2 + one VPS** running the API and a worker, and add worker VPSs as renders grow.
2. **Domain** for the app (for example `app.shortsinshort.com`).
3. **Accounts:** MongoDB Atlas, Cloudflare R2, an email provider on your domain (Resend/Brevo/SES), an uptime monitor.
