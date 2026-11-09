# Phase 3 — AI Avatar Studio

Goal: **script → AI voice → talking presenter → captions/brand → finished short**, with consent built in
for any real person's face or voice.

## Provider decisions (2026-11-09)

| Capability | Provider | Status |
|---|---|---|
| Text-to-speech + voice cloning | **ElevenLabs** (`ELEVENLABS_API_KEY`) | Chosen. Free tier is enough to build and test. |
| Talking avatar / lip-sync | **Not chosen yet** (HeyGen or D-ID) | Built behind an `AvatarProvider` interface; plugged in when chosen. Until then avatar rendering reports "not configured" — no fake output. |
| Script writing help | Gemini (already configured) | Reused from Phase 2. |

## Steps

Each step is usable on its own and nothing is shown as working before it is.

| Step | Scope | Needs |
|---|---|---|
| **3.1 Voices** ✅ built | ElevenLabs adapter (voice list, previews, TTS with word timings), Voice Library page, "Narrate a script" → narration audio, TTS credit pricing | `ELEVENLABS_API_KEY` |
| **3.2 Consent & custom voices** | `consentrecords` collection: who, whose likeness/voice, recorded consent statement (audio/video), attestations, IP/user-agent/time, revocation. Instant voice clone only after a valid consent record; revoking deletes the clone at the provider. Audit log entries. | ElevenLabs key |
| **3.3 Avatar Studio projects** | Wizard: script (write / AI-assist with Gemini), choose voice, choose avatar, background, format. Pipeline: TTS → avatar render (provider) → Phase 2 finishing (captions from TTS word timings — no transcription cost, Brand Kit logo, watermark, music). "AI-generated" disclosure label on every avatar video. Without an avatar provider: narration-only export (voice + captions over a background/brand card) so the step is still useful. | ElevenLabs key; avatar provider for presenter video |
| **3.4 Avatar provider** | Adapter for the chosen provider: stock avatar list, render job submit + poll/webhook, download into our storage, cost tracking, failures → refund. Custom avatars from a consented recording. | HeyGen or D-ID API key |

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
- Avatar video: **5 credits per started 30 s** (adjusted once the provider's price is known).
- Cost always shown before confirmation; refunds on failure as in Phase 2.

## Data model additions

- `voices` — workspace custom voices: provider, providerVoiceId, name, language, consentRecordId, status.
- `consentrecords` — subject name/email, kind (voice/avatar), statement asset, attestations, ip, userAgent,
  grantedAt, revokedAt, revokeTokenHash.
- `avatars` — (3.4) provider avatar id, name, preview, custom flag, consentRecordId.
- `Project.settings` (mode `avatar`): voiceId, avatarId, background, speakingRate, disclosure.
- Asset kinds: `narration_audio`, `consent_recording`.
