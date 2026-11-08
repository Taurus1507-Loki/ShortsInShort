# Phase 4 feature spec — Motion Explainer videos

Status: **Planned (Phase 4).** Not built. Added to the roadmap on 2026-11-08.

## Goal
Type a topic (e.g. "What is Generative AI?") and get a polished, fully animated explainer — kinetic
UI-style cards, icons, diagrams, typing effects, voiceover, music and sound effects — in minutes,
in all aspect ratios and in English, Hindi, Telugu, Tamil and Marathi.

Reference: `C:\Ai-video-Editor\out\GenAI-Preview.mp4` — a 59 s, 1080×1920, 30 fps Remotion video
with ~20 hand-coded scenes and hand-tuned timings. Motion Explainer automates what that project
did by hand.

## Where it lives
A **style inside the Faceless Video creator** ("Stock footage" | "Motion Explainer"), sharing its
script, scene-planning, narration and credit flow.

## How it works
1. **Script** — user enters a topic or script; LLM writes/improves it (shared with Faceless).
2. **Scene planning** — LLM maps each line to a scene template and fills its parameters, output as
   validated JSON (zod schema per template). No free-form code generation.
3. **Narration** — TTS per scene; scene durations come from the audio, so timing is automatic.
4. **Audio** — licensed music bed with ducking under narration; SFX cues defined per template.
5. **Render** — Remotion server-side rendering (`@remotion/renderer`) in a dedicated worker
   queue (headless Chromium), 9:16 / 16:9 / 1:1 / 4:5, 720p–4K by plan.
6. **Edit** — user can reorder scenes, edit text, swap templates/icons, regenerate one scene.

## Scene template library (v1 target: 12–15)
| Template | Example from the reference |
|---|---|
| Title card (eyebrow + headline) | "WHAT IS Generative AI?" |
| Icon orbit around a central symbol | chip with text/music/image/video icons |
| Card grid (2–4 cards with mini-illustrations) | "AI can… Stories / Images / Videos" |
| Pill list with indicators | Text / Images / Videos / Music rows |
| Chat window with typing + reply | chat prompt "Write a short" |
| Prompt → result | prompt typing, then generated image reveal |
| Process flow (input → model → output) | prompt → neural network |
| Network / training diagram with progress | nodes + "Training 65%" |
| Idea → output | lightbulb → video timeline |
| Audience map (centre + labelled nodes) | Students / Developers / Businesses / Creators |
| Big question / reveal | "?" with orbiting icons |
| Stat counter / comparison | — |
| Call to action (follow / subscribe) | "AI & Technology — Following" |

Every template takes text, icon set and **Brand Kit** colours/fonts, so videos match the user's brand.
Templates must not imitate third-party product UIs; product names appear only as user text.

## Credits (initial assumption)
Per started 30 s of output, priced above stock-footage Faceless videos because Chromium rendering
costs more CPU. Final pricing after render-cost measurements.

## Prerequisites & risks
- **Remotion licence:** free for individuals and companies of up to 3 people; a paid Company
  License is required beyond that — obtain before commercial launch.
- **Render cost/time:** headless-browser rendering is heavier than FFmpeg; needs its own worker
  pool, concurrency limits and measured per-second costs.
- Depends on Phase 2.3 (LLM adapter), Phase 4 TTS, a licensed music/SFX library and the Brand Kit.
- Indic-script typography in templates must be tested (font support, line breaking).

## Definition of done
Topic → rendered 30–60 s explainer with automatic timing, in all 4 aspect ratios and 5 languages,
editable per scene, credits charged/refunded via the existing job queue, with tests covering
scene-plan validation and a real render.
