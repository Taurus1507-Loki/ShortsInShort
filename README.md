# ShortsInShort

> **Your Script. Your AI Editor. Your Video. Done.**

AI video creation SaaS (React + TypeScript + Tailwind / Node + Express + MongoDB).
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the architecture, schema design, provider
strategy, cost estimates, MVP scope and roadmap, and [docs/API.md](docs/API.md) for the REST API.

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | Landing page, design system, auth (email/password, verification, reset, Google OAuth, sessions), workspaces, dashboard, project drafts | ✅ Implemented & tested locally |
| 2 AI Video Editor | **2.1 done:** uploads, job queue + worker, pause removal, reframing, loudness, FFmpeg render, credits + refunds, Media Library. 2.2–2.5 (captions, B-roll, music, editor) need API keys — see [docs/PHASE2.md](docs/PHASE2.md) | 🟡 In progress |
| 3 Avatar Studio | **3.1 built:** AI voices (Sarvam AI by default; ElevenLabs optional) — voice library, script → voiceover MP3 with word timings, credits + refunds. **3.2 built:** consented voice cloning (spoken consent checked by speech-to-text, email confirmation for other people, withdrawal deletes everything). **3.3 built:** AI script writing and finished voiceover videos (background + voiceover + timed captions, B-roll, logo, AI label). Needs `ELEVENLABS_API_KEY` (cloning: ElevenLabs Starter+). **3.4 built:** talking presenters via HeyGen API v3 (full frame or cut out over the background, reused on re-render). Needs `HEYGEN_API_KEY` — see [docs/PHASE3.md](docs/PHASE3.md) | 🟡 In progress |
| 4 Faceless & Motion Explainer | **4.1 built:** topic → AI script → voiceover → AI scene plan with licensed Pixabay clips (swappable) → video timed to the voiceover. **4.2 built:** scene editor (split/merge/move/reword, on-screen text, re-plan one scene, own video/image with motion). **4.3 built:** Motion Explainer — 10 animated templates (Remotion), AI template planning, live preview, headless-Chrome render. **4.4 built:** generated sound effects timed to scenes/animations, stock scene transitions, render timing + cost report. **Phase 4 complete** — see [docs/PHASE4.md](docs/PHASE4.md) | ✅ Built (live voice render needs keys) |
| 5 Payments | Razorpay credit top-ups, subscriptions (renew, cancel, upgrade/downgrade), webhooks, GST invoices (PDF) — see [docs/PHASE5.md](docs/PHASE5.md) | ✅ Built (Razorpay test-mode run needs keys) |
| 6 Admin & security | Admin console (overview metrics + daily charts, user search, credit/plan/suspend/role actions with mandatory reasons, free retry of failed jobs, payments, voice-consent takedown, audit log), abuse limits on job starts, security audit — see [docs/PHASE6.md](docs/PHASE6.md) and [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) | ✅ Built |
| 7 Launch | | Not started |

**Not production-ready.** Deployment (Phase 7) is not done, and live checks of the keyed providers
(Sarvam/ElevenLabs, HeyGen, Razorpay) are pending; unfinished areas are marked "Soon" and no feature
pretends to work. The previous prototype is archived,
untouched and not built, in [`legacy/`](legacy/).

## Prerequisites

- Node.js 20.11+ (tested on 24)
- MongoDB 7+ running locally (`mongodb://127.0.0.1:27017`) — or `docker compose up -d mongo`

## Run locally

```bash
npm install
npm run install:all
cp server/.env.example server/.env   # then set JWT_ACCESS_SECRET (see the comment in the file)
npm run dev
```

- Web app: http://localhost:5173 (Vite proxies `/api` to the API)
- API: http://localhost:5000/api/health

Without SMTP configured, **emails are printed to the API console** (look for `[DEV EMAIL …]`) —
open the verification / reset link from there.

Promote a verified user to admin (roles are never assignable through the API):

```bash
npm --prefix server run seed:admin -- you@example.com super_admin
```

## Tests

```bash
npm test             # 195 API tests (incl. real FFmpeg renders and caption burn-in) against a throwaway mongod
npm run typecheck    # server + client
npm run build        # production builds
```

The test suite covers registration, login, enumeration resistance, NoSQL-injection rejection,
origin checks, refresh-token rotation and replay detection, logout/session revocation, email
verification (single-use, credits granted once), password reset/change, account deletion,
project CRUD, validation/mass-assignment, **tenant isolation**, pagination, dashboard figures and
credit-ledger idempotency/concurrency.

## Environment variables (server/.env)

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `JWT_ACCESS_SECRET` | ✅ | ≥32 random chars for signing 15-min access tokens |
| `APP_URL` | ✅ | Public URL of the web app (emails, OAuth redirect) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | ✅ in production | Transactional email |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Google sign-in (button appears only when set) |
| `SARVAM_API_KEY` | for voices | AI voiceovers + voice cloning (Sarvam AI, Indian languages) — default voice provider |
| `ELEVENLABS_API_KEY` | optional | Alternative voice provider (`TTS_PROVIDER=elevenlabs`) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | for payments | Razorpay checkout, subscriptions, webhooks |
| `BILLING_LEGAL_NAME`, `BILLING_GSTIN`, `BILLING_ADDRESS`, `BILLING_STATE_CODE` | for invoices | Seller details on GST invoices |
| `HEYGEN_API_KEY` | optional | Talking presenters in Avatar Studio (HeyGen API v3) |
| `REQUIRE_EMAIL_VERIFICATION`, `FREE_PLAN_CREDITS` | optional | Policy knobs |
| `TRUST_PROXY`, `CORS_ORIGINS`, `COOKIE_SECURE` | deploy | Reverse proxy / origin settings |

## Security notes (Phase 1)

- Argon2id password hashing (OWASP parameters); constant-time-ish login for unknown emails.
- Access token in memory only; opaque refresh token in an httpOnly, `SameSite=Strict` cookie scoped
  to `/api/auth`, stored hashed, rotated on every use, with replay detection.
- Every authenticated request checks the session is live, so "sign out device" is immediate.
- zod `.strict()` validation on every body (rejects `$`-operators and unknown fields).
- Helmet headers, CORS allow-list, Origin check on state-changing requests, per-IP/email rate limits.
- Every user-owned query is scoped by `workspaceId`; covered by tests.
- Audit log for sign-ins, failed logins, password changes, session revocations, deletions.

Known gaps to close in later phases: Redis-backed rate limits and session cache (multi-instance),
MongoDB transactions for the credit ledger (needs a replica set), scheduled hard-purge of deleted
accounts, CSP for the static site, error tracking.
