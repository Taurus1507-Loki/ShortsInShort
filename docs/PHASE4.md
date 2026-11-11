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
| **4.3 Motion Explainer** | Remotion templates (12–15: title card, card grid, pill list, chat typing, process flow, stat counter, CTA…), LLM fills template parameters as validated JSON, server-side render in its own worker (headless Chromium), Brand Kit colours/fonts, Indic typography. | ✅ Built — Remotion licence needed before commercial launch (>3 people) |
| **4.4 Sound & polish** | SFX cues per template, music bed defaults per style, per-scene transitions, render-cost measurement → final pricing. | ✅ Built |

## Pricing (assumption until render costs are measured)
- Stock-footage faceless video: **1 credit per started 30 s** of voiceover (×2 for 4K) — downloads and
  re-encodes several clips, so priced above the editor's 1/min.
- Motion Explainer: **2 credits per started 30 s** (×2 for 4K) — Chromium rendering; re-check after measuring render costs.
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

## Step 4.3 — what's built (2026-11-11)

- **Style switch** on Faceless projects: Stock footage | **Motion Explainer** (works without a stock key).
- **10 templates** (React + Remotion, `client/src/motion/`): title card, statement (highlighted word), big
  number (counts up), list, card grid, process (arrows), comparison, chat (typing + reply), icon orbit, call to
  action. 48 whitelisted icons; drifting brand-colour backdrop; everything sized from the short side so all
  4 aspect ratios work. Brand Kit primary/secondary drive the theme (dark base derived from the primary).
  Telugu/Hindi text renders and shapes correctly (font stack with Nirmala UI / Noto Indic).
- **AI planning:** scenes are split in code as before; Gemini picks a template per scene and fills its fields
  (short on-screen text in the narration's language). Answers are validated with strict per-template zod
  schemas (field limits, icon whitelist, no extra fields); invalid ones become safe text scenes and the page
  says when AI wasn't available. No generated code is ever executed.
- **Render:** Remotion `bundle` (cached per process; `MOTION_BUNDLE_DIR` for a prebuilt bundle) + `renderMedia`
  in headless Chrome (downloaded by Remotion on first use, ~131 MB), each scene exactly as long as its
  narration → silent MP4 → voiceover laid under it → normal pipeline (captions, logo, watermark, music, label).
  Cancellable; `MOTION_CONCURRENCY` limits CPU.
- **Editing:** per scene “Edit animation” (template picker + fields, validated by the server), AI re-plan of one
  scene (asks for a different template), split gives the new half a simple scene. Live **preview player**
  (`@remotion/player`) of the whole explainer and a still per scene, using the same compositions as the server
  (preview timing is estimated; the video follows the voiceover).
- **Fixes found while testing live:** (1) Gemini sometimes exceeded our 90 s limit and, given one flat schema
  with every template's fields, filled unrelated fields with junk — now the schema is just
  `{index, template, params-as-JSON}` with an output cap, and Gemini runs at `thinkingLevel: low`
  (`GEMINI_THINKING_LEVEL`) for all our structured tasks: a 4-scene plan now takes ~3 s with no fallbacks.
  (2) **Partial project updates were applying creation defaults** (blanking script/topic and resetting
  style/format when only one field was sent, e.g. attaching a video or switching a setting) — fixed, with a
  regression test.
- **Verified live (2026-11-11):** templates rendered to stills (incl. Telugu/Hindi), a real Remotion MP4 render,
  AI motion planning in the app (title → cards → statement) with the preview player.
- **Tests:** 7 (`motion.test.ts`) incl. a real headless-Chrome render; plus the partial-update regression test.
- **Licence:** Remotion is free for individuals and companies of up to 3 people; a Company License is needed
  beyond that — before commercial launch (in the launch checklist).

## Step 4.4 — what's built (2026-11-11)

- **Sound effects, synthesised in code** (`services/audio/sfx.ts`): whoosh, pop, tick, ding, typing click,
  impact — generated with FFmpeg (no third-party samples, nothing to license), cached once per server.
  **Cues** follow the animations: whoosh between scenes; Motion Explainer pops as list/card/process/orbit items
  appear, ticks while a number counts then a bell, typing clicks in chat, a low hit on titles, a bell on the
  call to action (timings mirror `client/src/motion/scenes.tsx`). Stock videos get whooshes on transitions only.
  Mixed quietly under the voice (each sound read once and split to its cues), before music ducking and
  loudness normalisation. Setting: **Sound effects** (on by default).
- **Scene transitions for stock footage:** Fade (default) / Slide / Wipe / Cut via FFmpeg `xfade`, centred on
  each scene change; scenes are extended so the video stays exactly as long as the voiceover (checked to the
  millisecond in tests). Motion Explainer scenes already animate in and out.
- **Music per style:** unchanged and still library-dependent — "Match the style" maps the editing style to a
  mood; music plays only once a licensed library is configured.
- **Render-cost measurement:** every render now records `renderMs`; `npm --prefix server run metrics:render`
  reports render seconds per output minute by video type / style / resolution from real projects.
- **Tests:** 5 (`sfx.unit.test.ts`: cue timing per template, mixing graph, real generated sounds placed exactly
  at their cue, transitions keep length) + end-to-end checks in the faceless and motion flows.

### Measured render times (this dev laptop: Intel Core Ultra 5 125H, 18 threads, 17 GB; 2026-11-11)

```
Step (30 s of output)                         Time
Motion Explainer 720x1280 (Remotion)          39.8 s   (was 238.8 s before removing CSS blur → ~6x faster)
Motion Explainer 1080x1920 (Remotion)         81.4 s   (was 476.9 s)
Motion first-render warm-up (bundle+browser)  ~7–12 s  (once per worker process)
Stock scenes 1080x1920, fade transitions       18.6 s
Sound-effects mix                              2.6 s
Final pipeline 1080p (no captions/B-roll)      7.9 s
=> 30 s stock faceless @1080p ≈ 30 s of render; 30 s Motion Explainer @1080p ≈ 90 s
```

Pricing note: these are single-render wall-clock times on a laptop; production costs depend on the server
size and concurrency. Use `metrics:render` on real traffic before finalising prices. Current prices stay:
stock faceless 1 credit / 30 s, Motion Explainer 2 credits / 30 s, editor 1 credit / minute.

