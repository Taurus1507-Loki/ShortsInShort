# ShortsInShort API (Phase 1)

Base path: `/api`. JSON in/out. Success: `{ "data": … }` (lists add `meta`). Errors:
`{ "error": { "code": "…", "message": "…", "details"?: … } }`.

Authenticated endpoints need `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes;
get a new one from `POST /auth/refresh` (uses the httpOnly `sis_rt` cookie).

## Public

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{status, db, uptimeSec}` — 503 if DB down |
| GET | `/meta` | Plans (INR, paise), enabled auth providers, feature flags |

## Auth — `/auth`

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/register` | `{fullName, email, password, acceptTerms: true}` | 201 `{user, accessToken}` + refresh cookie. Sends verification email. 409 `EMAIL_TAKEN` |
| POST | `/login` | `{email, password}` | 401 `INVALID_CREDENTIALS` (same for unknown email). Rate-limited 10/15 min per IP+email |
| POST | `/refresh` | — (cookie) | Rotates the refresh cookie; `{user, accessToken}` |
| POST | `/logout` | — (cookie) | Revokes this session. 204 |
| GET | `/me` | — | `{user, workspace{plan, creditBalance, storage…}}` |
| POST | `/verify-email` | `{token}` | Single use, 24 h. Grants free-plan credits once |
| POST | `/resend-verification` | — (auth) | Invalidates earlier links |
| POST | `/forgot-password` | `{email}` | Always 200 (no enumeration) |
| POST | `/reset-password` | `{token, password}` | Single use, 1 h. Revokes all sessions |
| GET | `/google` | — | Redirects to Google (state + PKCE). 503 `NOT_CONFIGURED` if unset |
| GET | `/google/callback` | — | Creates/links user, sets cookie, redirects to `APP_URL/auth/callback` |

Password policy: 10–128 chars, letters and numbers.

## Users — `/users` (auth)

| Method | Path | Body | Notes |
|---|---|---|---|
| PATCH | `/me` | `{fullName}` | |
| POST | `/me/password` | `{currentPassword?, newPassword}` | `currentPassword` required if one is set. Revokes other sessions |
| GET | `/me/sessions` | — | Active devices, `current` flag |
| DELETE | `/me/sessions/:id` | — | Sign out one device |
| POST | `/me/sessions/revoke-others` | — | |
| DELETE | `/me` | `{confirm: "DELETE", password?}` | Deactivates + anonymises account, soft-deletes projects |

## Projects — `/projects` (auth; scoped to caller's workspace)

| Method | Path | Notes |
|---|---|---|
| GET | `/?page&limit&status&mode&q` | Paginated (`limit` ≤ 50) |
| POST | `/` | Requires verified email. Body: `{title, mode: editor|avatar|faceless, aspectRatio?, style?, script?, topic?, settings?}` |
| GET | `/:id` | 404 for other tenants' projects |
| PATCH | `/:id` | Any create field except `mode`; `settings` merges. 409 while processing |
| DELETE | `/:id` | Soft delete. If an export, voiceover or scene plan is still running, it is stopped and refunded first |
| POST | `/:id/stop` | Stops the running or queued job (export, voiceover, scene planning). Refunds its credits once and puts the project back to `draft`, or `completed` if it already has a video. `{project, refundedCredits, stopped}`; 409 `NOTHING_TO_STOP` |

`settings`: `captionsEnabled, captionStyle, captionPosition, highlightColor (#RRGGBB), musicMood,
bRollIntensity, editingIntensity, language (en|hi|te|ta|mr), targetDurationSec (5–3600),
resolution (720p|1080p|4k)`.

## Dashboard — `/dashboard` (auth)

| GET | `/summary` | Plan, credit balance, credits used this month, project counts by status, storage, 5 recent projects |
|---|---|---|

## Assets — `/assets` (auth; scoped to caller's workspace)

| Method | Path | Notes |
|---|---|---|
| POST | `/uploads` | `{filename, contentType, sizeBytes}` → `{asset, upload:{method:'PUT', url, headers, expiresAt}}`. Requires verified email. MP4/MOV/M4V/WEBM/MKV, ≤ `MAX_UPLOAD_MB`, within storage quota |
| PUT | *(signed `upload.url`)* | Send the raw file bytes with the given headers |
| POST | `/:id/complete` | Verifies real size, magic bytes and ffprobe (video track, ≤ `MAX_SOURCE_DURATION_SEC`); counts storage. 400 `INVALID_UPLOAD` |
| GET | `/?kind&page&limit` | Ready uploads and renders |
| GET | `/:id/url?download=1` | Signed URL (1 h) for playback or download |
| DELETE | `/:id` | Removes bytes, frees storage. 409 if a render using it is in progress |

## Generation — `/projects/:id` (auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/estimate` | `{credits, balance, sourceDurationSec, resolution, resolutionAllowed, planMaxResolution}` |
| POST | `/generate` | 202 `{job, credits}`. 402 `INSUFFICIENT_CREDITS`, 403 `PLAN_LIMIT`, 409 `PROJECT_BUSY`, 501 for faceless. Avatar projects: 400 `NO_NARRATION` / `NO_BACKGROUND`, 409 `NARRATION_OUTDATED` / `VOICE_WITHDRAWN`; estimate adds `narrationOutdated` |
| GET | `/job` | Latest job `{status, stage, progress, attempts, error}` for polling |

Projects also accept `sourceAssetId` on create/update and return `sourceAsset`, `outputAsset`,
`renderStats`, `lastError`.

## AI Video Editor timeline — `/projects/:id` (auth, mode `editor`)

| Method | Path | Notes |
|---|---|---|
| GET | `/analyze/estimate` | `{credits, balance, sourceDurationSec, transcribes}` — 3 credits per started minute, 0 when the footage was analysed before |
| POST | `/analyze` | 202 `{job, credits}`. Transcribes, finds pauses and filler words, lays out captions → `project.edit` |
| POST | `/auto-edit` | Body `{pace?: natural|fast}`. Same price as `/analyze`. Analyses, then builds the whole edit: pauses and fillers cut, AI hook line (opening line when the AI is slow), B-roll, zooms on key words, a library track matched to the mood, sound effects. Replaces text, zooms, B-roll, music and sound effects; keeps manual cuts. Summary in `edit.auto` |
| GET | `/words` | Transcript words |
| POST | `/captions/rebuild` | Lays captions out again for the current style |
| POST | `/broll/suggest` · `/broll/search` | B-roll moments + clips (download links never reach the browser) |
| POST | `/graphics/suggest` | Free. AI places motion graphics from what is said (word rules when the AI is slow): `counter` (value, prefix, suffix, label), `emoji` (emoji, label), `callout` (text, heading, icon). Replaces `edit.graphics`; `meta {suggested, plannedWith}` |
| PATCH | `/edit` | Partial timeline save: `pauseSec, removeFillers, cuts, restores, zooms, texts, captions, broll, music, sfx, segments`. `sfx`: `[{at, kind: whoosh|pop|impact|ding|tick|type, volume? 0–1.5}]` (source seconds, max 150). `graphics`: `[{start, end (0.8–8 s), kind, position: top|middle|bottom, color?, …}]` (max 40) |

Sound-effect files for the preview: `GET /api/music/sfx/:kind` (WAV, synthesised by the server — no third-party samples).

## Batch create — `/batches` (auth)

| Method | Path | Notes |
|---|---|---|
| POST | `/estimate` | Body `{name, templateId?, aspectRatio?, style?, settings (voiceId required, facelessStyle stock|motion, language, resolution…), videos: [{title?, script (20–5000 chars)}] (1–30)}` → `{videos: [{durationSec, narration, export, total}], total, balance}`. 400 `NO_VOICE` / `INVALID_VOICE`, 403 `PLAN_LIMIT`, 503 `NOT_CONFIGURED` |
| POST | `/` | Same body; requires verified email and `balance ≥ total` (402 otherwise). Creates one Faceless project per script (`batchId`, `autopilot.state: running`) and starts each voiceover → 201 `{batch, started}`. Each video then plans its scenes and exports by itself; every step is charged when it starts, at the normal step price |
| GET | `/` | Batches, newest first, with `videos`, `done`, `stopped` counts |
| GET | `/:id` | `{batch, projects}`; a project's `autopilot` is `{state: running|done|stopped, error}` (e.g. no clip found for a scene, not enough credits). Stopping a video (`POST /projects/:id/stop`) stops its autopilot |

Templates now carry `niches` (creators, tech, doctors, coaches, finance, real_estate, business, educators, food, storytellers).

## Photo avatars — `/avatars` (auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/photo/status` | `{avatarsConfigured, consentCheckConfigured, limit, used, createCredits, per30sCredits}` |
| GET | `/photo/statement?subjectName=` | The consent sentence to read aloud (names the person and the workspace) |
| GET | `/photo` | The workspace's photo avatars with their consent |
| POST | `/photo` | `{name, relationship: self|other, subjectName, subjectEmail? (other), attestations{rightsAndConsent, notPublicFigure, acceptsUsePolicy}, statementAssetId (purpose consent), photoAssetId (purpose avatar_photo: PNG/JPG ≥ 512×512)}`. Verifies the spoken statement (400 `CONSENT_NOT_MATCHED`). Self: charged 80 credits and created now (`creating` → `ready`); other: they confirm by email first. 402 `INSUFFICIENT_CREDITS`, 403 `PLAN_LIMIT`, 503 `NOT_CONFIGURED` |
| POST | `/photo/:id/retry` | Retries a failed avatar (charged again; the failed attempt was refunded) |
| DELETE | `/photo/:id` | Withdraws consent: deletes the avatar at the provider, the photo and the consent recording |

A ready avatar's `avatarId` is used as a project's `settings.avatarId`; `GET /ai/avatars` lists the workspace's own avatars first (`own: true`) and returns `meta.prices`. Presenter estimates add `photoAvatar`; a withdrawn avatar returns 409 `AVATAR_WITHDRAWN`. Consent links (`/consent/lookup|confirm|withdraw`) handle both voices and avatars (`kind`, `avatarName`).

## Avatar Studio voiceover — `/projects/:id` (auth, mode `avatar`)

| Method | Path | Notes |
|---|---|---|
| GET | `/narration/estimate` | `{credits, balance, characters, maxCharacters}` — 2 credits per started 400 characters (≈30 s), max 5,000. All prices: [PRICING.md](PRICING.md) |
| POST | `/narrate` | 202 `{job, credits}`. Uses the saved `script`, `settings.voiceId`, `settings.language`, `settings.speakingRate`. 400 `NO_SCRIPT` / `SCRIPT_TOO_LONG` / `NO_VOICE` / `INVALID_VOICE` / `WRONG_MODE`, 402 `INSUFFICIENT_CREDITS`, 409 `PROJECT_BUSY`, 503 `NOT_CONFIGURED` |

Projects return `narrationAsset` (MP3, kind `narration_audio`) and `narrationStats`
(`durationSec, characters, chunks, wordCount, timingsAvailable, voiceId, voiceName, model, language, creditsCharged`).
Word timings are stored server-side for captions (step 3.3) and not returned.

## Voices — `/voices` (auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Voice list `{id, name, category, gender, age, accent, description, useCase, previewUrl, languages}`; cached 10 min. 503 `NOT_CONFIGURED` without `ELEVENLABS_API_KEY`, 502 `PROVIDER_ERROR` |

## Custom voices — `/voices/custom` (auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/status` | `{voicesConfigured, consentCheckConfigured, limit, used, minSampleSec, maxSampleSec, matchThreshold}` |
| GET | `/statement?subjectName=` | `{statement}` — the sentence to read aloud |
| GET | `/` | Workspace voices with `status` (`awaiting_consent`/`cloning`/`ready`/`failed`/`revoked`), `voiceId` once ready, and `consent` |
| POST | `/` | `{name, language, relationship: self|other, subjectName, subjectEmail?, attestations{rightsAndConsent, notPublicFigure, acceptsUsePolicy}, statementAssetId, sampleAssetIds[]}` → 201. Errors: 400 `CONSENT_NOT_MATCHED` / `SAMPLES_TOO_SHORT` / `SUBJECT_EMAIL_REQUIRED`, 403 `PLAN_LIMIT`, 503 `NOT_CONFIGURED` |
| DELETE | `/:id` | Withdraws consent for the workspace and deletes the clone + recordings |

Recordings are uploaded with `POST /assets/uploads` and `purpose: voice_sample | consent` (MP3/WAV/M4A/WEBM/OGG, 3 s–5 min, ≤25 MB).

## Consent (public, no auth) — `/consent`

| Method | Path | Notes |
|---|---|---|
| POST | `/lookup` | `{token, purpose: confirm|withdraw}` → who asked, statement, status |
| POST | `/confirm` | `{token}` — single use, 7-day expiry (410 `TOKEN_EXPIRED`); starts cloning |
| POST | `/withdraw` | `{token}` — idempotent; deletes clone and recordings |

## AI writing — `/ai` (auth)

| Method | Path | Notes |
|---|---|---|
| POST | `/script` | `{topic, language?, durationSec? (15–180), style?, notes?}` → `{title, hook, script}`. 503 `NOT_CONFIGURED` without `GEMINI_API_KEY`, 502 `PROVIDER_ERROR`, 429 after 30/hour |
| GET | `/avatars` | Stock presenters `{id, name, gender, previewImageUrl, previewVideoUrl, orientation, tags}`; cached 30 min. 503 `NOT_CONFIGURED` without `HEYGEN_API_KEY` |

Avatar projects accept `settings.background` (`brand|color|image|video`), `settings.backgroundColor`,
`settings.disclosure` and top-level `backgroundAssetId` (a `background_image` upload — `purpose: background` —
or a ready `source_video`); they return `backgroundAsset`.
Presenter settings: `settings.avatarId` ('' = none) and `settings.avatarLayout` (`full|overlay`). With a
presenter the estimate adds `presenterCredits` and `presenterReused`; generate can return 400 `INVALID_AVATAR`
or 503 `NOT_CONFIGURED`.

## Faceless scenes — `/projects/:id` (auth, mode `faceless`)

| Method | Path | Notes |
|---|---|---|
| POST | `/scenes/plan` | 202 `{job}` — background job (free): splits the saved script into scenes, AI picks searches, one licensed clip per scene. 503 `NOT_CONFIGURED` without `PIXABAY_API_KEY`, 400 `NO_SCRIPT` |
| POST | `/scenes/:index/search` | `{query}` → project with that scene's new `candidates` (meta `{found}`) |
| PATCH | `/scenes/:index` | One of: `{clipId}` (choose a candidate), `{text}` (reword — rewrites the script), `{overlayText}` (≤80), `{assetId}` (own `source_video`/`background_image`, or `null`) |
| POST | `/scenes/:index/split` | `{atWord}` — split after that many words (voiceover stays valid) |
| POST | `/scenes/:index/merge` | Merge with the next scene |
| POST | `/scenes/move` | `{from, to}` — reorder (rewrites the script; voiceover must be redone) |
| POST | `/scenes/:index/replan` | AI picks new searches + candidates for one scene (meta `{found, plannedWith}`) |

Faceless projects return `scenes[]` (`text, queries, clip, candidates` — clips without download URLs),
`scenesKey`, `scenesOutdated`, `scenesPlannedWith` (`ai|keywords`). Generate errors: `NO_NARRATION`, `NO_SCENES`,
`SCENES_OUTDATED`, `SCENE_WITHOUT_CLIP`, `NARRATION_OUTDATED`, `VOICE_WITHDRAWN`; estimate adds `sceneCount`.
Voiceover endpoints (`/narrate`, `/narration/estimate`) accept faceless projects too.

Faceless settings (4.4): `settings.sceneTransition` (`cut|fade|slide|wipe`, stock style) and
`settings.soundEffects` (boolean). Render stats add `sceneTransition`, `sfxCount` and `renderMs`.

## Billing — `/billing` (auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{configured, keyId, pricesIncludeGst, gstRate, plan, plans[], packs[], subscription, billing}` |
| PUT | `/profile` | `{legalName, gstin, address, stateCode}` — GSTIN must start with the state code |
| POST | `/orders` | `{packId}` → `{orderId, amountPaise, keyId, credits, prefill}` for Razorpay Checkout |
| POST | `/orders/verify` | `{orderId, paymentId, signature}` → credits once; 400 `INVALID_SIGNATURE` |
| POST | `/subscriptions` | `{planId, period}` → `{subscriptionId, keyId}`; 409 `ALREADY_SUBSCRIBED` |
| POST | `/subscriptions/verify` | `{subscriptionId, paymentId, signature}` → plan + credits |
| POST | `/subscriptions/cancel` | Cancels at the end of the cycle |
| POST | `/subscriptions/change` | `{planId}` → upgrade now / downgrade at cycle end; 409 `PLAN_CHANGE_UNSUPPORTED` (UPI/e-mandate) |
| GET | `/payments`, `/invoices`, `/invoices/:id/pdf` | History and GST invoice PDFs |

`POST /api/billing/webhook` (public, Razorpay): `X-Razorpay-Signature` over the raw body; `x-razorpay-event-id` deduplicated.

## Admin — `/admin` (auth, role `admin` or `super_admin`; 120 req/min per admin)

Every mutation needs a `reason` (3–300 chars) and is written to the audit log as `admin.*` with `targetUserId`.

| Method | Path | Notes |
|---|---|---|
| GET | `/overview` | Users, plans, live subscriptions, revenue (30 d / month), credits, projects, jobs + failure rate, queue, storage, failed webhooks |
| GET | `/metrics?days=1..90` | Daily series (IST): signups, renders completed/failed, revenuePaise, creditsUsed |
| GET | `/users?q&status&page&limit` | Search by email/name |
| GET | `/users/:id` | Profile, workspace, projects, subscription, payments, credit history, sessions, recent audit |
| POST | `/users/:id/credits` | `{amount, reason, requestId(uuid)}` — idempotent per requestId; 402 if the balance would go below 0 |
| POST | `/users/:id/plan` | `{plan, reason}` — 409 `HAS_SUBSCRIPTION` while a paid subscription is live |
| POST | `/users/:id/status` | `{status: active\|suspended, reason}` — suspension revokes all sessions |
| POST | `/users/:id/role` | Super admin only; `{role, reason}`; admin roles need a verified email (400 `NOT_VERIFIED`) |
| GET | `/jobs?status` · POST `/jobs/:id/retry` | Failed (dead) jobs; retry requeues free of charge |
| GET | `/payments?status` | Paid/failed payments with customer email and invoice number |
| GET | `/consents?status` · POST `/consents/:id/revoke` | Voice consent takedown (deletes the clone and recordings) |
| GET | `/audit?action&userId` · `/webhooks` · `/storage` | Audit log (action prefix filter), webhook events, storage by workspace |

Admins can't act on themselves; only a super admin can act on admins. Bootstrap the first super admin with `npm --prefix server run seed:admin -- <email> super_admin`.

## Templates — `/templates` (auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | All templates: `{id, name, category, description, mode, aspectRatio, style, settings, title, topic, script, bestFor, motionScenes?, preview: motion\|stock\|none, favorite}` |
| PUT · DELETE | `/:id/favorite` | Star / unstar for the current user (idempotent; 404 for an unknown template) |
| GET | `/:id/preview` | `{thumbnails: string[]}` — up to 3 https stock thumbnails for the template's sample search (cached 6 h; empty without a stock provider) |

