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

## 4.5 Templates gallery (added 2026-11-16)

The original Phase 4 scope included a Templates page. It was left as a "Soon" placeholder when Phase 4 was marked complete, and was built later:

- **Catalogue** (`server/src/config/templates.ts`): 13 templates across marketing, social, education, business and lifestyle.
  - Product promo, AI tool explainer, Top 5 tips, Daily news recap, Podcast clip, Viral talking head, How-to tutorial, Property showcase, Motivational quote, Startup pitch, Team announcement, Recipe in 60 seconds, Hindi explainer.
  - Each sets the mode, editing style, frame, settings, a title, a topic and a script outline (editor templates give recording tips instead).
  - Tests check every template against the real project-creation schema, and every sample animation against the Motion scene schemas.
- **API:** `GET /api/templates` (with the user's favourites), `PUT/DELETE /api/templates/:id/favorite`, `GET /api/templates/:id/preview`.
  - The preview returns Pixabay thumbnails for the template's sample search, cached for 6 h. Video files are never hotlinked.
- **Gallery** (`/app/templates`): search, category chips, Favourites filter and star toggles.
  - Cards preview real stock thumbnails or stills of the template's animated scenes. The preview dialog plays the animation live (Remotion Player) and shows the settings and script outline.
- **Use template** opens `/app/new?mode=…&template=…`. The wizard pre-fills the title, topic, script, style, frame and settings, applied after the Brand Kit defaults so the template's own choices win. Everything stays editable.

## B-roll pacing (changed 2026-11-16)
AI Video Editor B-roll now adds more and longer stock cutaways:

| Setting | Spacing | Clip length | Gap |
|---|---|---|---|
| Low | 1 per 15 s | ~2.5–3.5 s | 3 s |
| Medium | 1 per 8 s | ~4–5 s (≈40% of the video) | 2 s |
| High | 1 per 5 s | ~4.5–6 s (≈70%) | 1 s |

Previously it was one clip per 20/12/7 s, at most 3.5 s each. A cutaway may now continue over the next sentence.


## Motion Explainer look refresh (2026-11-16)
- **Themes:** 10 colour themes, 6 of them light (Cream, Mint, Lavender, Peach, Sky, Paper) and 4 dark, plus Brand Kit light or dark. The default, "Surprise me" (`auto`), gives each project its own theme. Pick one on the Style step (`settings.motionTheme`). Defined in `client/src/motion/themes.ts`.
- **Backgrounds:** each scene gets its own background (glow, mesh, grid, dots, aurora, diagonal, spotlight, waves or rings), never the same twice in a row.
- **Transitions** (`@remotion/transitions`): a different one at every cut, chosen from zoom-through, spin, blinds, diamond, split, swing-slide, slide, wipe, flip, cube, clock-wipe and iris. Only CSS-based transitions are used; the WebGL ones need an experimental Chrome feature. The outgoing scene is extended by the transition length, so scenes still start exactly with their words and the video keeps the voiceover's length.
- **Lottie** (`@remotion/lottie`, drawn on canvas):
  - Animated emoji stickers (Google Noto, CC BY 4.0), chosen from each scene's words and type, on about half the scenes.
  - Card, process and orbit icons draw themselves (useAnimations, MIT), recoloured to the theme.
- **Captions** are drawn inside the animation and animate word by word in the 5 caption styles. They still honour caption edits, translation and AI keywords; FFmpeg no longer burns captions into Motion Explainer videos.
- **Stock-footage videos** get new FFmpeg transitions: Mix (a different xfade at every cut, now the default), Smooth push, Zoom in, Circle reveal, Motion blur and Pixelate.
- **Speed:** the effects make animated renders about 1.3× slower (measured on a 12.5 s, 720p sample). A 6 s, 720p export took 13 s end to end.
- Credits and licences: `/legal/credits` and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Background music from Pixabay (2026-11-16)
- Pixabay's API has **no music endpoint** (only images and videos), and its terms forbid scraping or mass downloads, so tracks are added by hand.
- How to add music:
  1. An admin downloads tracks from pixabay.com/music. They're free under the Pixabay Content License: commercial use is fine and no credit is needed.
  2. Drop them on **Admin → Music library**, or run `npm run music:import -- <folder>` (development only, because the production image has no dev tools).
- Each upload goes through these checks and steps:
  - It must be real audio (checked by its first bytes) and 10 s–15 min long.
  - It's converted to a 192 kbps MP3 at **−16 LUFS**, so every track sits at the same level under the voice.
  - Title and artist come from the Pixabay file name, and moods are guessed from it (upbeat, calm, cinematic, corporate or lo-fi).
  - Re-uploading the same file is ignored.
- Admins can play, re-tag or remove tracks, and see how many tracks each mood has (aim for at least 3 per mood).
- The library lives in `<STORAGE_LOCAL_DIR>/music` by default (`/data/storage/music` in Docker, on the storage volume). The render picks a track for the project's mood ("Match the style" follows the editing style), lowers it under speech and fades it out. This uses the existing music engine.
- API: `GET/POST /api/admin/music`, `PATCH/DELETE /api/admin/music/:file`, `GET /api/admin/music/:file/audio`. All are admin-only and audited.

## Auto edit — Release A of the ReelsDone-inspired plan (2026-11-23)

One button on the Edit step turns raw footage into a finished edit on the timeline: pauses and filler
words cut (natural 0.6 s or fast-paced 0.3 s), a hook line in the first 2.8 s (Gemini, 20 s cap; the
opening line or first early question when the AI is slow), word-by-word captions, B-roll (shared
`services/video/brollSuggest.ts`; never over the hook), punch-in zooms on highlighted words (one per
4 s, not during B-roll), a music-library track matched to the mood the AI picks, and sound effects
(impact on the hook, whooshes in and out of B-roll, pops on zooms; 0.6 s minimum spacing). Everything
is ordinary timeline data, so the user can change or delete any of it, and "Auto edit again" redoes it.

- Code: `services/video/autoEdit.ts` (planner), `analyze_project` job with `payload.auto`, `POST /projects/:id/auto-edit`.
- Sound effects are a new timeline track (`edit.sfx`), synthesised by FFmpeg (`services/audio/sfx.ts`), played in the live
  preview and mixed into the export after rendering (with a limiter so they never clip).
- Price: the same as analysing (3 credits per minute, free when already analysed); export prices are unchanged.

## Motion graphics on footage — Release B (2026-11-23)

Three animated graphics over real footage: a **number counter** (counts up to a stat the speaker
says, then lands with a bell), an **animated emoji** pop-up with an optional label, and a **callout
card** (heading, key point, animated line icon, underline sweep). AI picks the moments from the
transcript (Gemini, 20 s cap; word rules — numbers like "1%", "₹10,000", "3x" become counters, strong
words get an emoji — when it's slow), at most one per 5 s and one per 8 s of video, sliding to the
first kept moment that's clear of the hook and B-roll. Auto edit adds them (with pop / ding / whoosh
sound effects); "Suggest graphics" re-plans them; every graphic is editable on the new Graphics track.

- One React component (`client/src/motion/graphics.tsx`) draws them in the live preview and in the export:
  the server renders each graphic alone with Remotion (`GraphicClip` composition, ProRes 4444 with
  transparency, one headless browser per export, ~4 s per graphic, hard 60 s + 20 s/graphic limit) and
  FFmpeg lays it over the footage above B-roll, below captions. If drawing fails the export continues
  without graphics and says so.
- `MOTION_BUNDLE_DIR` bundles must be rebuilt (`npm run motion:prepare`) to include `GraphicClip`.

## Niche templates and batch create — Release C (2026-11-23)

- **Niche templates:** every template says who it is for (`niches`), and the gallery has a "Made for" filter
  (Creators, Tech & AI, Doctors, Coaches, Finance & CAs, Real estate, Businesses, Educators, Food, Storytellers).
  Six new templates: Tech & AI update, Doctor's health tip, Money tip, Fitness coach, Know your rights, Storytime
  (19 in total). The preview dialog shows "You give" (a script like this) next to "You get" (the animation).
- **Batch create** (`/app/batch`): pick a Faceless template, visuals, language, quality (capped by plan) and one
  voice, paste up to 30 scripts separated by `---`, see the live price, and create. Each script becomes a normal
  project that runs voiceover → scene planning → export on its own (`services/batch/autopilot.ts`, driven by a
  job-finished hook in the worker). Steps are charged as they start at the usual prices; the batch needs its
  estimated total up front. A video whose next step can't start (no clip for a scene, not enough credits, a failed
  step, or the user pressed Stop) stops with a note; the others carry on and it can be finished from its page.
- The batch page shows each video's step (Voiceover, Planning scenes, Exporting, Ready, Needs you) and links to
  watch and download. Verified locally: 2 videos, voiced by Sarvam, scenes planned by Gemini, exported in ~75 s.
