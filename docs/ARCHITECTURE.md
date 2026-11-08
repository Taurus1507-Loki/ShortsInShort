# ShortsInShort — Architecture & Delivery Plan

Status: **Phase 1 (Foundation) in progress.** Nothing in this document should be read as
"already working" unless the Phase status table at the bottom says it is verified.

---

## 1. Requirements analysis (condensed)

ShortsInShort is a multi-tenant SaaS with three creation modules (AI Video Editor, AI Avatar,
Faceless Creator) sharing one orchestration + rendering engine, wrapped in standard SaaS
concerns (auth, billing in INR via Razorpay, credits, admin, notifications).

The hard parts, in order of risk:

1. **Rendering at acceptable cost/latency** — FFmpeg jobs are CPU-heavy and long-running; they
   must never run in the API process.
2. **Credit correctness** — reservations, refunds on failure, and idempotency across retries and
   webhook redelivery.
3. **Third-party AI dependence** — every AI capability is a paid external API with its own
   failure modes, quotas and terms (especially avatar/voice cloning consent).
4. **Tenant isolation & media privacy** — user footage and biometric data must never leak.

## 2. Production architecture

```
                   ┌──────────────┐
  Browser (SPA) ──▶│  CDN / Nginx │──▶ static React build
        │          └──────────────┘
        │ HTTPS (JSON, Bearer access token; refresh token in httpOnly cookie)
        ▼
  ┌──────────────────────────┐      ┌───────────────┐
  │  API (Express, stateless)│─────▶│   MongoDB     │  users, workspaces, projects,
  │  auth · projects · credits│      │ (replica set) │  sessions, ledger, audit log
  │  billing · admin · uploads│      └───────────────┘
  └──────────┬───────────────┘
             │ enqueue (BullMQ)          ┌──────────────────────┐
             ▼                           │ Object storage (R2/S3)│ private bucket,
        ┌─────────┐   consume   ┌────────┴──────┐  signed URLs  │ presigned upload/download
        │  Redis  │◀───────────▶│ Workers        │──────────────▶└──────────────────────┘
        └─────────┘             │ ai-orchestrator│──▶ LLM / STT / TTS / avatar / stock APIs
                                │ render (FFmpeg)│
                                └────────────────┘
```

* **Modular monolith API + separately deployable workers.** Same codebase, different entry points
  (`server.ts`, later `worker.ts`). Modules communicate through services, not HTTP, so any one
  can be extracted later.
* **Stateless API** → horizontal scaling behind a load balancer. All shared state lives in Mongo,
  Redis or object storage.
* **Uploads go straight from browser to object storage** via presigned URLs; the API never proxies
  large files.
* **Workers** scale on queue depth; render workers get CPU-optimised instances, with job
  timeouts, retries with backoff, and a dead-letter queue that triggers credit refunds.

## 3. Repository structure

```
ShortsInShort/
├── client/                 React 18 + Vite + TS + Tailwind + Framer Motion + TanStack Query
│   └── src/
│       ├── components/ui/  shadcn-style primitives (Button, Input, Card, Dialog…)
│       ├── components/     layout, marketing sections, app shell
│       ├── features/       auth, projects, dashboard, settings (hooks + components)
│       ├── lib/            api client, query client, theme, utils
│       ├── pages/          route-level pages (marketing, auth, app, legal)
│       └── config/         plans, nav, content constants
├── server/                 Node 22+ / Express / TS (ESM) / Mongoose
│   └── src/
│       ├── config/         env validation (zod), db, logger
│       ├── middleware/     auth, rbac, validate, rate limits, origin check, errors
│       ├── models/         Mongoose schemas
│       ├── modules/        auth, users, projects, dashboard, health (routes+controller+service)
│       ├── services/       email, tokens, audit, credits
│       ├── utils/          errors, crypto helpers, async handler
│       └── __tests__/      vitest + supertest against a real mongod
├── docs/                   this file, API reference
├── legacy/                 previous prototype, archived untouched (not built or run)
└── docker-compose.yml      local Mongo (+ Redis from Phase 2)
```

## 4. MongoDB schema design

All user-owned documents carry `workspaceId` (tenant key) and every query on them is scoped by it.

| Collection | Key fields | Indexes |
|---|---|---|
| `users` | email (lowercased), passwordHash (argon2id, nullable for Google-only), fullName, role (`super_admin`/`admin`/`customer`/`team_member`), status (`active`/`suspended`/`deleted`), emailVerifiedAt, googleId, defaultWorkspaceId, lastLoginAt | `email` unique, `googleId` unique sparse |
| `workspaces` | name, ownerId, plan (`free`…`agency`), creditBalance, storageBytesUsed, members[{userId, role}] | `ownerId`, `members.userId` |
| `sessions` | userId, refreshTokenHash, family, userAgent, ip, expiresAt, revokedAt, lastUsedAt | `refreshTokenHash` unique, `userId`, TTL on `expiresAt` |
| `authtokens` | userId, type (`email_verify`/`password_reset`), tokenHash, expiresAt, usedAt | `tokenHash` unique, TTL on `expiresAt` |
| `projects` | workspaceId, createdBy, title, mode (`editor`/`avatar`/`faceless`), status (`draft`/`queued`/`processing`/`completed`/`failed`), aspectRatio, style, settings{captions, music, bRollIntensity, editingIntensity, language, targetDurationSec, resolution}, script, deletedAt | `{workspaceId, updatedAt}`, `{workspaceId, status}` |
| `credittransactions` | workspaceId, type (`grant`/`reserve`/`consume`/`refund`/`adjust`/`purchase`), amount (signed), balanceAfter, idempotencyKey, reference{kind,id}, note | `idempotencyKey` unique, `{workspaceId, createdAt}` |
| `auditlogs` | actorId, workspaceId, action, ip, userAgent, metadata | `{actorId, createdAt}`, TTL configurable |

Later phases add: `assets` (uploaded media, storage key, size, mime, checksum), `jobs`
(queue mirror for UI), `templates`, `brandkits`, `avatars` + `consentrecords`, `subscriptions`,
`payments`, `invoices`, `webhookevents` (unique provider event id → idempotent webhooks),
`supporttickets`.

**Credits** are a ledger: balance changes only through `CreditService`, which updates the workspace
balance with a conditional `$inc` (`creditBalance >= amount`) inside a transaction, and inserts a
ledger row keyed by `idempotencyKey`. A duplicate key → the operation already happened → return the
original result. That makes retries and webhook redelivery safe.

## 5. External APIs (provider adapters — all swappable)

| Capability | Primary candidate | Alternatives | Needed in |
|---|---|---|---|
| Transactional email | Any SMTP (Resend, Brevo, SES, Postmark) | — | Phase 1 (dev logs to console) |
| Google sign-in | Google OAuth 2.0 client | — | Phase 1 (optional) |
| Object storage | Cloudflare R2 (no egress fees) | AWS S3 | Phase 2 |
| Speech-to-text (word timestamps) | Deepgram Nova | OpenAI Whisper API, AssemblyAI | Phase 2 |
| LLM (hooks, scene planning, keywords) | Gemini Flash / GPT-4o-mini class | Claude Haiku | Phase 2 |
| Stock B-roll / images (licensed) | Pexels, Pixabay (free licences) | Storyblocks (paid) | Phase 2 |
| Music & SFX | Licensed library you own/subscribe to | Epidemic Sound API | Phase 2 |
| Text-to-speech (Indic languages) | ElevenLabs | Azure Speech, Google TTS, Sarvam AI | Phase 3/4 |
| Avatar + lip-sync | HeyGen API | D-ID, Synthesia | Phase 3 |
| Image generation | Imagen / SDXL hosted | — | Phase 4 (optional) |
| Payments | Razorpay (INR, subscriptions, webhooks) | — | Phase 5 |
| Errors / monitoring | Sentry, Grafana/Prometheus | — | Phase 6–7 |

Rule: a feature that needs a provider is disabled with a clear "not configured" response when the
credentials are missing. **There are no mock providers that return made-up results.**

## 6. Cost estimates (rough, list prices — verify before pricing decisions)

Per 60-second short (AI Video Editor path):

| Item | Est. cost |
|---|---|
| Transcription (~1 min audio) | ₹0.40–0.70 |
| LLM analysis (hooks/keywords/B-roll queries, ~5–10k tokens on a small model) | ₹0.10–0.50 |
| Stock media (Pexels/Pixabay) | ₹0 |
| Render compute (~1–3 CPU-min at 1080p) | ₹0.30–1.50 |
| Storage + egress (R2, ~50 MB kept 30 days) | ≈₹0.10 |
| **Total** | **≈ ₹1–3** |

Avatar video: dominated by the avatar provider, typically **₹15–80 per minute** depending on plan —
this is why avatar credits must cost more. TTS adds ≈ ₹2–10 per minute of narration.

Infrastructure at MVP scale (≈100–1,000 users): MongoDB Atlas M10 (~₹5k/mo), managed Redis
(~₹1–2k/mo), 1 API + 1–2 render instances (~₹6–15k/mo), R2 (~₹500–2k/mo), email (free tier →
~₹1.5k/mo). **≈ ₹15–25k/month** before AI usage. At the proposed Starter price (₹499 / 20 credits)
an editor-only workload keeps a healthy gross margin; avatar-heavy plans need a per-credit price
check once provider contracts are known.

## 7. MVP scope

**In MVP (Phases 1–2 + 5):** accounts & workspaces, landing page, dashboard, projects, the
AI Video Editor (upload → transcribe → silence cut → captions → B-roll → music → render 9:16/16:9/1:1
at 720p/1080p → download), basic editor adjustments, credits, Razorpay subscriptions.

**Post-MVP:** Avatar Studio (needs provider contract + consent/KYC flow), Faceless Creator,
template marketplace publishing, team workspaces, 4K, WhatsApp/push notifications.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Render cost/latency higher than estimated | Measure in Phase 2 with real footage; 720p previews, 1080p final render only on export |
| Provider price changes / outages | Adapter layer, per-provider cost tracking, fallback provider configured |
| Deepfake / impersonation misuse | Consent capture + liveness/ID verification, revocation, disclosure watermark, audit trail |
| Copyright claims on B-roll/music | Only licensed sources; store licence metadata per asset |
| Credit double-spend / double-charge | Ledger + idempotency keys + transactions; webhook event de-duplication |
| Indic-language TTS/STT quality | Evaluate providers per language before advertising support |
| Legal/regulatory (DPDP Act 2023, GST) | Policies are drafts pending lawyer review; GST invoicing in Phase 5 |
| Scope creep (spec is very large) | Strict phase gates; nothing marked done without tests |

## 9. Implementation sequence

1. **Foundation** — monorepo, design system, landing, auth (email/password, verification, reset,
   Google OAuth, session management), workspaces, dashboard, project creation wizard (draft only).
2. **Core AI Video Editor** — R2 uploads, BullMQ + Redis, STT adapter, silence detection, captions
   (ASS), B-roll adapter, music bed, FFmpeg render worker, export, editor UI.
3. **Avatar Studio** — consent records, provider adapter, avatar/voice management.
4. **Faceless Creator** — script → scenes → TTS → media → render; templates.
5. **Monetization** — Razorpay subscriptions/top-ups, webhooks, invoices, credit reservation.
6. **Admin & security** — admin panel, analytics, audit review, pen-test checklist.
7. **Launch** — Docker images, CI/CD, staging, backups, load tests, monitoring.

---

## Phase status

| Phase | Status |
|---|---|
| 1 Foundation | In progress |
| 2–7 | Not started (legacy prototype code exists in `legacy/` but is not trusted or wired in) |
