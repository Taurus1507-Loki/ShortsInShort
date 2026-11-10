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
| DELETE | `/:id` | Soft delete |

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

## Avatar Studio voiceover — `/projects/:id` (auth, mode `avatar`)

| Method | Path | Notes |
|---|---|---|
| GET | `/narration/estimate` | `{credits, balance, characters, maxCharacters}` — 1 credit per started 400 characters, max 5,000 |
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
| PATCH | `/scenes/:index` | `{clipId}` — choose one of the scene's candidates (400 `INVALID_CLIP`) |

Faceless projects return `scenes[]` (`text, queries, clip, candidates` — clips without download URLs),
`scenesKey`, `scenesOutdated`, `scenesPlannedWith` (`ai|keywords`). Generate errors: `NO_NARRATION`, `NO_SCENES`,
`SCENES_OUTDATED`, `SCENE_WITHOUT_CLIP`, `NARRATION_OUTDATED`, `VOICE_WITHDRAWN`; estimate adds `sceneCount`.
Voiceover endpoints (`/narrate`, `/narration/estimate`) accept faceless projects too.

