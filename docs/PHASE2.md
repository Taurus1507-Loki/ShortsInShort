# Phase 2 — AI Video Editor

Phase 2 is delivered in steps. Each step is usable on its own and nothing is presented as working
before it is.

| Step | Scope | Status |
|---|---|---|
| **2.1 Core edit** | Uploads, storage, job queue + worker, silence/pause removal, aspect-ratio reframing, loudness normalisation, H.264 render, thumbnail, credit charging with refunds, Media Library | ✅ Implemented, tested (unit + integration with real FFmpeg) and verified in the browser |
| 2.2 Transcription & captions | Word-timestamp STT adapter (Deepgram / Whisper), filler-word removal, animated ASS captions with keyword highlights | Needs an STT key |
| 2.3 AI analysis & B-roll | LLM adapter (hooks, keywords, B-roll queries), Pixabay/Pexels adapter, B-roll overlays | Needs LLM + stock-media keys |
| 2.4 Music & polish | Licensed music bed with ducking, zooms on key moments, Brand Kit (logo/colours/fonts, watermark for Free) | Needs a licensed music library |
| 2.5 Editor & infra | Caption editing, scene tweaks, Redis/BullMQ queue driver, R2 verification | Needs Redis + R2 credentials |

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
