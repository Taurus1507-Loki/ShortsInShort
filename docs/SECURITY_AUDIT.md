# Security audit — Phase 6.3 (2026-11-14)

A review of the codebase as it stands after Phase 6 (admin panel). It covers what is already in place, what changed in this audit, and what still has to be done before launch. Items marked **Launch** are also on [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md).

## Results at a glance

| Area | Status |
|---|---|
| Dependencies (`npm audit`, server + client) | 0 known vulnerabilities |
| Secrets in git history | None. No `.env` has ever been committed |
| Authentication and sessions | Good. Suspension is enforced everywhere |
| Authorisation (workspace scoping, admin roles) | Good. Covered by tests |
| Input validation | Every body-accepting route uses zod `.strict()` |
| Rate limiting | Good per instance. Needs Redis for multiple instances (**Launch**) |
| Payments | Signatures and webhooks are verified, idempotent and deduplicated |
| Voice cloning consent | Recorded statement is verified; revocable by the subject, workspace or admin |
| Outbound requests (SSRF) | Only provider-issued https URLs are fetched |
| HTTP headers | Helmet + strict API CSP; the web app gets its own strict CSP when served by the API (Phase 7) |

## What is in place

**Authentication**
- Passwords are hashed with argon2id. Login is limited per IP and per email, and errors don't reveal whether an account exists.
- Access tokens are short-lived. Refresh tokens rotate on every use and live in an httpOnly, SameSite cookie. Reusing an already-rotated refresh token revokes that session.
- Email verification and password-reset tokens are random, stored only as hashes, single-use and time-limited.
- A suspended account is blocked at login, at Google sign-in and on every authenticated request (`requireAuth`). Suspending someone from the admin panel also revokes all their sessions.

**Authorisation**
- Every project, asset, voice and billing query is scoped to the caller's workspace, so another workspace's ID returns 404.
- The admin API requires the `admin` or `super_admin` role. Admins can't act on themselves.
- Only a super admin can manage other admins or change roles, and promotion requires a verified email.

**Admin accountability**
- Every admin change is written to the audit log. This covers credits, plan, suspend/reactivate, role, free job retries and voice takedowns, each with the admin's ID, the target user and a mandatory reason.
- Credit adjustments are idempotent per request ID and can never take a balance below zero.

**Money and credits**
- Credits move only through the ledger (`applyCreditChange`), with idempotency keys. Failed jobs refund automatically, and admin retries are free.
- Razorpay order and subscription signatures are checked with HMAC-SHA256 using constant-time comparison.
- Webhooks are verified on the raw body with the webhook secret and deduplicated by `x-razorpay-event-id`.
- Amounts always come from the server-side price list, never from the client.

**Input and output**
- Every body-accepting route uses zod `.strict()`: unknown fields are rejected, and partial updates never apply create defaults.
- Uploads are checked by magic bytes, have size limits and use per-plan storage quotas. Media is served through signed, expiring URLs.
- Errors return a stable `{ error: { code, message } }` without stack traces. Request IDs are logged, and secrets are redacted by the logger.

**Abuse limits**
- Separate limiters cover login, registration, password reset, sensitive actions, AI writing, voice samples, consent pages, webhooks, admin (120/min per admin) and, new in this audit, **job starts** (120/hour per user).
- The job-start limiter covers generate, narrate, scene plan, scene search and scene replan.

**Voice cloning**
- Cloning requires a consent record whose spoken statement is transcribed and matched (≥70%). It is unavailable if speech-to-text isn't configured, so there is no unchecked bypass.
- Consent can be revoked by the voice owner (via an emailed link), by the workspace, or by an admin. Revoking deletes the provider clone and all recordings and keeps the consent record as evidence.

**Outbound requests**
- The server only downloads from https URLs returned by Pixabay and HeyGen API responses. Users can't supply them: a scene can only pick from its server-fetched candidates.
- Added in this audit: an https-only guard in the stock download, matching the one already in the avatar download.

## Changes made in this audit
1. Added `jobStartLimiter` on the five job-starting project routes.
2. Added `adminLimiter` on the whole admin API.
3. Added an https-only guard to stock-clip downloads.
4. Added `'admin'` as a consent revoker, with an audit trail.

## Open items

| # | Risk | Action | When |
|---|---|---|---|
| 1 | Rate-limit counters are in memory, so each instance counts separately | Back limiters with Redis (Upstash) | **Launch** |
| 2 | The ledger and job writes aren't in a single MongoDB transaction. Idempotency keys prevent double charges, but a crash between the two writes can leave a job without its charge | Use a replica set (Atlas has one) and wrap charge + enqueue in `withTransaction` | **Launch** |
| 3 | ~~The SPA has no CSP yet~~ | Done in Phase 7: `services/web/spa.ts` (verified in the browser; Razorpay Checkout to be rechecked with keys) | Done |
| 4 | `legacy/server/.env.example` contains placeholder secrets | Never reuse them. Generate fresh JWT/cookie secrets for production | **Launch** |
| 5 | The Gmail app password was exposed earlier in development | Rotate it and move mail to Resend/Brevo/SES on the own domain | **Launch** |
| 6 | Local media storage | Move to R2 with private buckets and signed URLs | **Launch** |
| 7 | Admin accounts have no 2FA | Add TOTP for admin and super-admin roles | Post-launch |
| 8 | No automated dependency updates | Enable Dependabot or Renovate on GitHub | Post-launch |

## How to re-run the checks
```bash
npm --prefix server audit
npm --prefix client audit
npm --prefix server test
git log --all --name-only --format= | grep -i "\.env$"
```
