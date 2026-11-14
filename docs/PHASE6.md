# Phase 6 — Admin panel, analytics and security

## What's built

**Admin console** (`/app/admin`, visible in the sidebar only to `admin` / `super_admin`):
- **Overview:** users (new this week, suspended, % verified), 30-day and this-month revenue, paid subscriptions by plan, jobs and failure rate, queue depth, credits used, projects by mode, storage, and a warning when webhooks fail or the failure rate is above 10%.
- **Daily charts (30 days, IST):** sign-ups, revenue, videos and voiceovers made, failed jobs. Each chart has a hover readout and a screen-reader table.
- **Users:** search by email or name. A user's details show their plan, credits, subscription, projects, payments, credit history, signed-in devices and recent activity.
  - Actions: adjust credits (±, idempotent, never below zero), set plan (blocked while a Razorpay subscription is live), suspend (signs them out everywhere) or reactivate. Each action needs a reason.
  - Super admins can also change roles through the API.
- **Failed jobs:** the error and attempt count for each failed job, plus **Retry free**, which requeues the job without charging credits again.
- **Payments:** paid and failed payments with the customer, amount, failure reason and invoice number.
- **Voice consents:** every cloned-voice consent, with a **Take down** button that deletes the provider clone and the recordings and keeps the consent record as evidence.
- **Audit log:** filterable by area (admin, sign-ins, billing, voice consent, projects).

**Rules enforced on the server:**
- Every admin action is audited with the admin's ID, the target user and the reason.
- Admins can't act on themselves, and only a super admin can act on admins or change roles.
- Admin roles require a verified email.

**Security (6.3):**
- New rate limits: job starts (120/hour per user) and the admin API (120/min per admin).
- An https-only guard on stock downloads.
- The full audit is in [SECURITY_AUDIT.md](SECURITY_AUDIT.md), including open items for launch.

## Setup
Promote the first super admin (their email must already be verified):
```bash
npm --prefix server run seed:admin -- you@example.com super_admin
```
After that, super admins manage roles from the admin API.

## Code
- Server: `server/src/modules/admin/admin.routes.ts`, `server/src/services/admin/metrics.ts`, limiters in `server/src/middleware/security.ts`.
- Client: `client/src/pages/app/AdminPage.tsx`; nav item in `components/app/AppLayout.tsx`.
- Tests: `server/src/__tests__/admin.test.ts` (access, metrics, credits idempotency, plan, suspension boundaries, roles, free retry, consent takedown, payments, audit).

## Verified
- 204/204 server tests pass, and both client and server typecheck cleanly.
- In the browser (local dev): the overview and charts load with real data, a +10 credit adjustment on a test account updated the balance, and the adjustment appears in the audit log with its reason.

## Not built yet
- 2FA for admins.
- Refunds from the console (do them in the Razorpay dashboard; the webhook keeps the records in sync).
- CSV exports.
