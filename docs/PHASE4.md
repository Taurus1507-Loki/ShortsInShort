# Phase 4 — Faceless Creator & Motion Explainer

Goal: **topic → script → voiceover → scenes → finished faceless video**, in two styles: real stock
footage, and animated "Motion Explainer" scenes (spec: [PHASE4_MOTION_EXPLAINER.md](PHASE4_MOTION_EXPLAINER.md)).
Reuses Phase 3: AI script writing, voiceovers with word timings, consented custom voices, the render
pipeline (captions, logo, watermark, music, AI label) and the job queue/credits.

## Steps

| Step | Scope | Status |
|---|---|---|
| **4.1 Stock-footage faceless videos** | Faceless project: topic → AI script → voiceover → **AI scene plan** (script split into ~4–8 s scenes in code, the LLM only picks stock searches per scene) → best licensed Pixabay clip per scene (tag-relevance filter, no clip reused) → scene cards with thumbnails; edit a scene's search and pick another candidate → render: clips cut to each scene's exact voiceover timing, scaled to fill the frame, then captions, logo, music, label. | ✅ Built |
| **4.2 Scene editor** | Reorder, split/merge scenes, edit on-screen text per scene, regenerate one scene, upload your own clip/image for a scene, Ken Burns motion on stills. | ✅ Built |
| **4.3 Motion Explainer** | Remotion templates (12–15: title card, card grid, pill list, chat typing, process flow, stat counter, CTA…), LLM fills template parameters as validated JSON, server-side render in its own worker (headless Chromium), Brand Kit colours/fonts, Indic typography. | Planned — Remotion licence needed before commercial launch (>3 people) |
| **4.4 Sound & polish** | SFX cues per template, music bed defaults per style, per-scene transitions, render-cost measurement → final pricing. | Planned |

## Pricing (assumption until render costs are measured)
- Stock-footage faceless video: **1 credit per started 30 s** of voiceover (×2 for 4K) — downloads and
  re-encodes several clips, so priced above the editor's 1/min.
- Motion Explainer: higher (Chromium rendering) — set in 4.3 after measuring.
- Voiceover is charged separately as in Phase 3 (1 per started 400 characters).

## Step 4.1 — what's built (2026-11-10)

- **Flow:** Faceless project (wizard: title, topic, script with "Write it with AI", voice) → voiceover
  (Phase 3.1) → **Plan scenes with AI** (background job, free) → scene cards → Video settings → render.
- **Scene split (code, not AI):** sentences merged/split into ~3.5–8 s scenes (≈2.5 words/s English,
  2.1 Indic), never losing or reordering a word; max 40 scenes; Devanagari full stops handled.
- **Visuals (AI):** Gemini gets the fixed scene texts and returns 3 English stock searches per scene
  (specific → common). Invalid/missing answers fall back to keywords from the scene; if Gemini is down the
  whole plan uses keywords and the page says so ("Searches were picked from keywords"). Gemini calls now
  retry temporary failures (429/500/503) twice.
- **Clips:** Pixabay search per query, only clips whose tags match the search, no clip used twice, up to 4
  candidates kept per scene with thumbnails. "Change clip": search with your own words, pick a candidate.
  Download URLs never reach the browser; source page + author shown per scene and in the render result.
- **Render:** scene timings come from the voiceover's word timings (scene i runs from its first word to the
  next scene's first word; falls back to splitting by text length). Each clip is looped if short, cut to its
  scene, scaled to fill the frame, joined, laid under the voiceover; then captions (exact word timing),
  logo, watermark, music, "AI-generated voice" label. No extra B-roll on top.
- **Checks before charging:** voiceover current (`NARRATION_OUTDATED`), scenes planned (`NO_SCENES`) for the
  current script (`SCENES_OUTDATED`), every scene has a clip (`SCENE_WITHOUT_CLIP`), cloned-voice consent
  active, stock configured.
- **Verified live (2026-11-10):** scene planning with real Gemini + Pixabay — e.g. "morning cafe queue",
  "barista latte art", "hands holding mug" with matching clips and thumbnails. First attempt hit a Gemini
  503 and fell back to keywords, which led to the retry + notice. Full render needs `ELEVENLABS_API_KEY`
  (voiceover); covered by tests with real FFmpeg.
- **Tests:** 8 (`faceless.test.ts`) + Gemini retry unit test.

## Step 4.2 — what's built (2026-11-11)

Scene cards on Faceless projects are now an editor:
- **Split** a scene at any word (click the word that starts the new scene) and **merge** with the next —
  the narration is unchanged, so the voiceover stays valid. The new half gets the next unused candidate clip.
- **Move** a scene up/down and **edit its words** — these change the script (rebuilt from the scenes), so
  the voiceover is flagged out of date and must be generated again before rendering (`NARRATION_OUTDATED`).
- **On-screen text** per scene (≤80 chars): burned in large in the upper third with a short fade, only during
  that scene (overlay layer, same pass as watermark/label).
- **Re-plan** one scene with AI (fresh searches, steering away from ones already tried; keyword fallback).
- **Your own media** per scene: upload a video (looped/cut like stock) or an image (slow pan, alternating
  direction); it replaces the stock clip and needs no attribution. Picking a stock clip again switches back.
  Deleting the file clears it from scenes; a missing file blocks the render (`SCENE_MEDIA_MISSING`).
- Edits are refused while the scene plan doesn't match the script (`SCENES_OUTDATED`) or the project is busy.
- **Verified live (2026-11-11):** split (3 → 4 scenes, words unchanged), on-screen text saved, AI re-plan of a
  scene with real Gemini + Pixabay ("morning cafe queue" → "cafe window order", new clip; ~40 s).
- **Tests:** 7 (`scene_editor.test.ts`) incl. a real render with an own image + on-screen text.

