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
