# Phase 3 — AI Avatar Studio

Goal: **script → AI voice → talking presenter → captions/brand → finished short**, with consent built in
for any real person's face or voice.

## Provider decisions (2026-11-09)

| Capability | Provider | Status |
|---|---|---|
| Text-to-speech + voice cloning | **ElevenLabs** (`ELEVENLABS_API_KEY`) | Chosen. Free tier is enough to build and test. |
| Talking avatar / lip-sync | **HeyGen API v3** (`HEYGEN_API_KEY`) | Chosen 2026-11-10 (user: build without waiting for keys). Behind an `AvatarProvider` interface, so D-ID could be added. Not yet tested against the live API. |
| Script writing help | Gemini (already configured) | Reused from Phase 2. |

## Steps

Each step is usable on its own and nothing is shown as working before it is.

| Step | Scope | Needs |
|---|---|---|
| **3.1 Voices** ✅ built | ElevenLabs adapter (voice list, previews, TTS with word timings), Voice Library page, "Narrate a script" → narration audio, TTS credit pricing | `ELEVENLABS_API_KEY` |
| **3.2 Consent & custom voices** ✅ built | `consentrecords` collection: who, whose likeness/voice, recorded consent statement (audio/video), attestations, IP/user-agent/time, revocation. Instant voice clone only after a valid consent record; revoking deletes the clone at the provider. Audit log entries. | ElevenLabs key |
| **3.3 Avatar Studio projects** ✅ built (voiceover video) | Wizard: script (write / AI-assist with Gemini), choose voice, choose avatar, background, format. Pipeline: TTS → avatar render (provider) → Phase 2 finishing (captions from TTS word timings — no transcription cost, Brand Kit logo, watermark, music). "AI-generated" disclosure label on every avatar video. Without an avatar provider: narration-only export (voice + captions over a background/brand card) so the step is still useful. | ElevenLabs key; avatar provider for presenter video |
| **3.4 Avatar provider** ✅ built (stock presenters) | Adapter for the chosen provider: stock avatar list, render job submit + poll/webhook, download into our storage, cost tracking, failures → refund. Custom avatars from a consented recording. | HeyGen or D-ID API key |

## Step 3.1 — what's built (2026-11-09)

- **Adapter** `server/src/services/ai/tts.ts`: `GET /v2/voices` (paged, cached 10 min) and
  `POST /v1/text-to-speech/{voice}/with-timestamps` (MP3 44.1 kHz). English/Hindi/Tamil use
  `eleven_multilingual_v2`; Telugu/Marathi use `eleven_v3` with `language_code` (configurable).
  Bad key, quota, unknown voice and unreadable script are permanent failures (no retries, refund).
- **Job** `narrate_project` (`services/audio/narrationJob.ts`): script split at sentence boundaries
  (≤2,500 chars, neighbouring text passed for natural flow) → parts joined → loudness −16 LUFS → MP3
  asset; character timings grouped into words and offset across parts; previous voiceover replaced.
- **Credits:** 1 per started 400 characters (≈30 s), script max 5,000 characters; charged up front,
  refunded once on final failure.
- **UI:** AI Voices page (`/app/voices`: search, gender/accent filters, free samples), Avatar project
  wizard (script → voice/language/speed → create), project page voiceover panel (cost, progress, player,
  MP3 download, "outdated" warning), voiceovers in the Media Library.
- **Tests:** 11 (stand-in provider, no paid calls): word grouping, chunking (incl. Devanagari), voice
  mapping, pricing, voices API on/off, generation + storage + timings, multi-chunk offsets and
  replacement, permanent-failure refund, validation, tenant isolation.
- **Not yet verified live:** needs `ELEVENLABS_API_KEY`. To check with the key: voice list loads,
  English voiceover sounds right, Telugu/Hindi pronunciation, and whether `eleven_v3` returns timings
  (if not, the voiceover still works and the panel says timings weren't returned).

## Step 3.2 — what's built (2026-11-10)

- **Flow (Voices page → "Add a voice"):** whose voice (mine / someone else's + their email) → voice
  samples (record in the browser or upload; ≥30 s total, 1–2 min recommended, ≤5 min) → the person
  reads a generated consent sentence naming themselves and the workspace → three attestations → create.
- **Consent check:** the consent recording is transcribed (Deepgram) and must contain ≥70% of the
  sentence's words, otherwise nothing is created and the user sees what was heard. No speech-to-text
  key → cloning is unavailable (no unchecked path).
- **Someone else's voice:** they get an email with a confirm link (7 days, single use) and a withdraw
  link. Nothing is sent to the provider until they confirm on the public `/consent/confirm` page.
- **Withdrawal** (`/consent/withdraw`, link emailed to the person in both cases, or "Remove" by the
  workspace): deletes the provider clone, the voice samples and the consent recording; the voice can no
  longer be picked or used (checked again when a voiceover job runs). The consent record (names, email,
  statement, transcript, match score, IP/user-agent, timestamps) is kept as evidence. Voiceovers made
  before withdrawal stay. The workspace owner is emailed when a third party withdraws.
- **Isolation:** the shared library lists ElevenLabs **premade** voices only; clones are listed from our
  own records per workspace, and every use re-checks ownership + active consent.
- **Plans:** custom voices kept at once — Free 0, Starter 1, Creator 3, Pro 5, Agency 10 (business
  assumption). Cloning costs no credits for now.
- **Provider:** ElevenLabs Instant Voice Clone (`POST /v1/voices/add`, samples converted to 192 kbps MP3)
  and `DELETE /v1/voices/{id}`. **Requires an ElevenLabs Starter plan or higher** (free tier can't clone),
  and each ElevenLabs plan has a voice-slot limit shared by all workspaces.
- **Tests:** 9 (stand-in voice + speech-to-text providers, real audio files): statement scoring, audio
  upload validation (MP3/WEBM, too short, fake files), self flow → clone → voiceover, mismatched
  recording, plan/sample/attestation/config checks, third-party confirm → clone → withdraw → deletion,
  expiry, isolation between workspaces, owner removal, provider refusal.
- **Known limits:** the check proves the sentence was said, not that the sample voice and the consent
  voice are the same person (speaker matching is a later improvement); consent sentence is English only;
  the "Add a voice" wizard has not been seen in a browser yet because it needs the ElevenLabs key.

## Step 3.3 — what's built (2026-11-10)

Without an avatar provider, an Avatar project now produces a finished **voiceover video**:

- **AI script writing** (`POST /api/ai/script`, Gemini): topic + length (15–180 s) + project language and
  editing style → spoken-words-only script sized at ~2.5 words/s (English) or ~2.1 (Indic), cleaned of
  markdown, bracketed directions and hashtags. Free, rate-limited (30/hour per user). Verified live: a 45 s
  English script took ~45 s to come back.
- **Background** (Video settings): Brand gradient (Brand Kit primary → secondary, slowly drifting), solid
  colour, uploaded image (slow pan, slightly dimmed; PNG/JPG/WEBP ≤15 MB, 320–8000 px) or uploaded video
  (looped, muted, dimmed).
- **Render** (same queue/job as the editor): background + voiceover → base clip at the final size, then the
  Phase 2 pipeline: captions from the voice provider's word timings (no transcription cost), caption
  translation / AI keywords, B-roll (needs Gemini + Pixabay only), zooms, Brand Kit logo, Free watermark,
  music, −14 LUFS. No pause cutting. Caption editing after render works as for the editor.
- **"AI-generated voice" label:** small, top-left (bottom-left if the logo is top-left); on by default,
  can be switched off for library voices, always on for cloned voices.
- **Checks before charging:** voiceover exists and matches the current script/voice/language/speed
  (409 `NARRATION_OUTDATED` otherwise), background file chosen for image/video (400 `NO_BACKGROUND`),
  cloned voice's consent still active (409 `VOICE_WITHDRAWN`), plan resolution.
- **Credits:** 1 per started minute of voiceover (×2 for 4K), same as the editor; refunded on failure.
- **Tests:** 8 (real FFmpeg renders): background args per kind, disclosure overlay, script cleaning +
  sizing + prompt, script API on/off/validation, full render (720p 9:16, captions, watermark, label,
  credits), image background with label off, outdated voiceover / missing background / foreign asset,
  cloned voice label forced + withdrawn consent blocks render.
- **Not verified live:** the full voiceover → video flow needs `ELEVENLABS_API_KEY`.

## Step 3.4 — what's built (2026-11-10)

- **Provider:** HeyGen **API v3** (v1/v2 were retired on 2026-10-31): `GET /v3/avatars/looks` (public
  looks, cached 30 min), `POST /v3/assets` (voiceover MP3, multipart), `POST /v3/videos`
  (`type: avatar`, `audio_asset_id`, `aspect_ratio`, `resolution`, `fit: cover`, solid `background`,
  `Idempotency-Key`), `GET /v3/videos/{id}` (pending → processing → completed/failed, `video_url`).
  HeyGen error codes map to friendly messages; credit/trial/consent/policy/unknown-avatar errors are
  permanent (no retries, refund).
- **Presenter in the render:** the presenter lip-syncs to *our* voiceover (so captions stay exact).
  Layouts: **Full frame** (presenter on the project's solid colour) or **Cut out** (requested on chroma
  green `#00B140`, keyed out with FFmpeg and stood at the bottom, ~78% of the frame tall, over the brand
  gradient / colour / image / video). Then the normal pipeline: captions, B-roll, logo, watermark, music.
  Keying checked visually on a test frame.
- **No double charges:** the provider video id is saved as soon as HeyGen accepts it, so a retried job
  polls the same video; the finished clip is stored (`avatar_video` asset) and reused on re-renders while
  the voiceover, presenter, layout colour and format are unchanged (estimate shows "presenter reused").
- **Credits:** presenter 5 credits per started 30 s of voiceover, plus the usual 1/min render — only when
  a new presenter clip is needed. Refunded if the job fails. The "AI-generated" label is always on with a
  presenter.
- **UI:** Video settings → Presenter (No presenter / Talking presenter, layout, searchable presenter grid
  with previews); render panel shows the presenter part of the cost and presenter progress stages.
- **Tests:** 8 with a stand-in provider returning a real green-screen clip: look/error mapping, compositing
  args, avatars API on/off, full-frame render + reuse without a second request/charge, cut-out layout,
  transient failure → same provider video polled, provider failure → refund, validation (unknown
  presenter, background needed only for cut-out, not configured).
- **Not built yet:** custom avatars of real people (needs a consent flow like 3.2 plus HeyGen digital-twin
  training); transparent WebM output for matting-trained avatars (green key used instead).
- **Needs a live check with `HEYGEN_API_KEY`:** background field name (`value` vs `color` differs between
  HeyGen pages), real lip-sync/timing vs our voiceover, keying quality on real presenters, render times.

## Consent rules (non-negotiable)

- A custom voice or avatar can only be created for **the account holder themself** or a person who
  records the consent statement on camera/mic ("I, ⟨name⟩, consent to ShortsInShort creating an AI
  voice/avatar of me for ⟨workspace⟩"). Stored with the asset, never deletable by the requester alone.
- No public figures / celebrities; the UI states this and the record carries an attestation.
- Revocation is self-serve for the consenting person via a link emailed to them; it deletes the
  provider clone and blocks new renders with it.
- Every avatar render carries "AI-generated" in the metadata and a small on-video disclosure option
  (on by default for custom avatars).

## Credits (proposal — confirm before Phase 5 pricing)

Avatar video costs ₹15–80 per minute at providers, narration ≈ ₹2–10 per minute, so:

- Narration only: **1 credit per started 400 characters** (≈30 s of speech) — implemented in 3.1.
- Avatar video: **5 credits per started 30 s** for the presenter — implemented in 3.4 (adjust once HeyGen's price is known).
- Cost always shown before confirmation; refunds on failure as in Phase 2.

## Data model additions

- `voices` — workspace custom voices: provider, providerVoiceId, name, language, consentRecordId, status.
- `consentrecords` — subject name/email, kind (voice/avatar), statement asset, attestations, ip, userAgent,
  grantedAt, revokedAt, revokeTokenHash.
- `avatars` — (3.4) provider avatar id, name, preview, custom flag, consentRecordId.
- `Project.settings` (mode `avatar`): voiceId, avatarId, background, speakingRate, disclosure.
- Asset kinds: `narration_audio`, `consent_recording`.
