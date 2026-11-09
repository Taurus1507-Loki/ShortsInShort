# Phase 2 — AI Video Editor

Phase 2 is delivered in steps. Each step is usable on its own and nothing is presented as working
before it is.

| Step | Scope | Status |
|---|---|---|
| **2.1 Core edit** | Uploads, storage, job queue + worker, silence/pause removal, aspect-ratio reframing, loudness normalisation, H.264 render, thumbnail, credit charging with refunds, Media Library | ✅ Implemented, tested (unit + integration with real FFmpeg) and verified in the browser |
| **2.2 Transcription & captions** | Provider interface + Deepgram adapter, transcript cache, filler-word removal, captions re-timed through cuts, 5 styles (bold pop, karaoke, boxed, clean, cinematic), rule-based keyword highlights, Indic-script captions, burn-in | ✅ Verified live with Deepgram (nova-3) on English speech: accurate transcript, captions in sync, keyword highlights. Deepgram accepts `hi`/`te`/`ta`/`mr`, but accuracy in those languages and filler-word detection still need testing with real recordings. |
| **2.3 AI analysis & B-roll** | Gemini adapter (structured JSON), AI keyword highlights, caption translation (EN/HI/TE/TA/MR), B-roll planning + Pixabay search with tag-relevance filtering, B-roll overlays under captions, attribution | ✅ Verified live (Gemini 3.5 Flash + Pixabay) on an English test clip; translation verified with a stand-in provider and in tests |
| **2.4 Music & polish** | Zoom punch-ins (Off/Subtle/Dynamic), Free-plan watermark, Brand Kit (logo corner/size/opacity, colours, default caption look applied to new projects), music engine (mood pick, ducking under speech, fade-out) | ✅ Built and verified in real renders. **Music needs your licensed library** (`MUSIC_LIBRARY_DIR` + `music.json`); until then renders say no music was added. Custom fonts and intro/outro clips not yet built. |
| **2.5 Editor & infra** | Caption editing after a render (wording, highlight, timing, add/delete lines) applied on re-render; live preview from a real frame (framing, captions, logo, watermark); source thumbnails | ✅ Editing + preview verified in the browser and in tests. **Redis/BullMQ queue and Cloudflare R2 storage: waiting for accounts** (Upstash Redis URL, R2 bucket + keys) so they can be tested against the real services. |

## How a render works (2.1)

```
Browser ──POST /assets/uploads──▶ API: create pending Asset, return signed PUT URL
Browser ──PUT bytes────────────▶ Storage (local signed URL or R2/S3 presigned URL)
Browser ──POST /assets/:id/complete▶ API: real size check · magic-byte type check · ffprobe (video track, duration) · storage quota
Browser ──POST /projects/:id/generate▶ API: lock project (queued) → debit credits (idempotent, keyed to job id) → enqueue job
Worker  ──claim (atomic)──────▶ probe → silencedetect → keep-segments → FFmpeg render → validate output → thumbnail → store
                                 success: project completed, previous render replaced
                                 final failure: project failed + credits refunded exactly once
Browser ──polls /projects/:id/job──▶ live stage + progress; then signed playback/download URLs
```

### The edit
- **Pause removal:** `silencedetect` thresholds come from the project's *editing intensity*
  (low −38 dB/1.0 s, medium −35 dB/0.6 s, high −32 dB/0.35 s). Kept speech is padded so words
  aren't clipped, near segments merge, slivers are dropped, and segment count is capped at 250.
- **Cutting:** frame-accurate `select`/`aselect` with timestamp rebuild (no re-muxing artefacts).
- **Reframe:** scale-to-cover + centre crop to 9:16 / 16:9 / 1:1 / 4:5 at 720p / 1080p / 4K.
- **Audio:** EBU R128 loudness normalisation to −14 LUFS (the common social-platform target).
- **Output:** H.264 High / AAC 160k, `+faststart` for instant streaming; validated with ffprobe
  (dimensions and duration) before it is saved.

### Credits
- AI Video Editor: **1 credit per started minute of source footage** (×2 for 4K) —
  `server/src/config/credits.ts`. Cost is shown before confirmation.
- Free plan exports up to 720p; higher resolutions return `PLAN_LIMIT`.

### Queue
MongoDB-backed (`server/src/services/queue/`): atomic claims (safe with many workers), 60 s leases
renewed by heartbeats, crash recovery via lease expiry, exponential backoff (5 s → 5 min),
max 3 attempts, dead-letter state with compensation (refunds), per-job timeout.
Chosen for this step because Redis isn't installed locally; the queue interface is small so a
BullMQ driver can replace it once Redis is provisioned (step 2.5).

### Storage
- `local`: files under `server/storage/`, served only through HMAC-signed, expiring URLs with Range
  support. Single server only.
- `s3`: Cloudflare R2 / AWS S3 with presigned URLs. **Implemented but not yet verified against a real
  bucket** — test with your credentials before production.

## Run it

```bash
npm run dev            # API + embedded render worker + web app
npm --prefix server run worker   # (production) run workers as separate processes
```

## Known limitations of 2.1
- No captions, B-roll, music, zooms or watermark yet (the UI and render notes say so).
- Centre crop only (no face tracking) when converting landscape → vertical.
- Storage `s3` driver unverified; the local driver is single-server.
- Bundled FFprobe is a 2023 build; use distro FFmpeg/FFprobe in production (`FFMPEG_PATH`, `FFPROBE_PATH`).

## Step 2.2 — captions

- **Transcription** runs only when a provider key is set and the project wants captions or filler
  removal (editing intensity medium/high). The source audio is sent as compact 16 kHz mono MP3.
  Transcripts are cached per (video, provider, language): re-renders never pay twice.
- **Failures are non-fatal:** if transcription fails (bad key, unsupported language), the video still
  renders and the result notes say exactly why captions are missing.
- **Filler words** ("um", "uh") reported by the provider are cut together with pauses.
- **Captions** are re-timed onto the edited timeline, grouped into short lines per style, and burned
  in with libass after reframing. Keyword highlighting is rule-based (numbers first, then the longest
  meaningful word) until the LLM step (2.3) picks keywords.
- **Languages:** Latin captions use Segoe UI (Windows) / Noto Sans (Linux); Hindi, Marathi, Telugu
  and Tamil use Nirmala UI / Noto Sans Devanagari, Telugu, Tamil with HarfBuzz shaping.
  Whether Deepgram supports each Indian language must be confirmed with a live key.

## Step 2.3 — AI keywords, translation, B-roll

- **One Gemini call per render feature**, always structured JSON validated before use; any failure
  falls back (rule-based keywords) or skips with an honest note (translation, B-roll). Render never fails
  because of AI.
- **Keywords:** Gemini picks one word per caption line; misses keep the rule-based pick.
- **Translation:** captions are translated line by line, keeping each line's timing (word timing within
  a translated line is approximated because languages reorder words).
- **B-roll:** Gemini picks sentences (never the opening hook) and gives 3 searches per moment, specific →
  common. A Pixabay clip is used only if its tags match the search (subject word weighted most); otherwise
  the moment is skipped — no unrelated footage. Code enforces 1.5–3.5 s clips, ≥2.5 s apart, ~1 per
  20/12/7 s (low/medium/high), and never in the first 2 s or last 1 s. Clips are full-frame hard cuts with
  the speaker's audio continuing; captions stay on top. Source page + author recorded per clip.
- Tests use stand-in providers and blank all real keys (no paid calls from the test suite).

## Step 2.4 — zooms, watermark, Brand Kit, music

- **Zoom punch-ins:** 1.08× (Subtle, ~every 3rd caption line) or 1.15× (Dynamic, ~every 2nd), landing on
  lines with a highlighted keyword; never during B-roll; ≤2.5 s; steady rhythm when there's no transcript.
- **Watermark:** Free plan only — "Made with ShortsInShort", top-right, ~60% opacity, above everything.
- **Brand Kit:** one per workspace. Logo (PNG/JPG/WEBP ≤5 MB, real-type checked) in a chosen corner, size and
  opacity; brand colours; default caption style/position/size/highlight applied to new projects when enabled.
  Per-project "Show my logo" toggle.
- **Music:** reads `MUSIC_LIBRARY_DIR/music.json`; uses only tracks that exist and declare a license. Mood comes
  from the setting ("Match the style" maps editing style → mood), stable per project. Music sits ~8 dB under
  speech and is ducked a further ~13 dB while someone talks (measured in tests: −21 dB in pauses vs −35 dB
  under speech), then fades out at the end.
- Render layer order: reframe → zoom → B-roll → logo → captions → watermark; audio: speech + ducked music → −14 LUFS.

## Step 2.5 — caption editing and live preview

- **Caption editing:** after a render, the final caption lines are stored with a fingerprint of the cut.
  Edits (text, highlighted word, start/end, add/delete) are validated (order, no overlap, keyword present)
  and used exactly as written on the next render — no AI rewriting, no new transcription. If a later change
  alters the cut (e.g. editing intensity), edits are set aside with a note instead of drifting out of sync.
- **Live preview:** a frame from the uploaded video (thumbnail taken at upload) shown in the chosen format and
  framing, with captions (style, size, position, highlight), Brand Kit logo and Free watermark, updating as
  settings change. It is an approximation of the final render.
- **Pending:** Redis/BullMQ queue driver and verified R2 storage — need an Upstash Redis URL and a Cloudflare R2
  bucket with API keys.
