# Credits and the step-by-step flow (2026-11-16)

This replaces the credit prices in the Phase 2–5 notes. The single source of truth is
`server/src/config/credits.ts`. The web app reads the same list from `GET /api/meta` (`pricing`).

## How making a video works

Each step is its own page, at `/app/projects/:id/:step`. Moving to another step saves the project. Every page says
what its step costs before anything is charged. Redoing a step charges only that step.

| Mode | Steps |
|---|---|
| Faceless (stock or animated) | Script → Voice → Scenes → Style → Export |
| AI Avatar / voiceover video | Script → Voice → Presenter → Style → Export |
| AI Video Editor | Footage → Style → Export |

Creating a project is two pages. `/app/new` is where you pick the mode, and `/app/new?mode=…` is the basics:
title, topic, visuals and format. Templates fill in the basics. Opening a project from the list goes to its first
unfinished step, or to Export once it's done.

Continue is blocked only on steps the video can't be made without: Footage, Script, Voice and Scenes. The message
under the button says what's missing.

## Credit unit

On 2026-11-16, credits were rescaled **10×** at the same rupee prices, so each step can be priced at its real cost:

| Plan | ₹ / month | Credits | ₹ per credit |
|---|---|---|---|
| Free | 0 | 30 (once, after verification) | — |
| Starter | 499 | 200 | 2.50 |
| Creator | 999 | 500 | 2.00 |
| Pro | 1,999 | 1,200 | 1.67 |
| Agency | 4,999 | 3,500 | 1.43 |

Top-ups: 100 credits for ₹299, 250 for ₹699, 600 for ₹1,499, and 1,500 for ₹3,499.

Existing data is migrated once at API start-up by `services/migrations.ts` (`2026-11-16-credits-x10`). It
multiplies balances, the ledger, payments, pending job refunds and the "credits charged" figures. A marker in the
`migrations` collection stops it running twice.

## Price per step

Prices are set at about **2× our provider cost**, so they still look light to users.

| Step | Credits | Our cost behind it |
|---|---|---|
| Script written by AI | free (daily limit) | Gemini, a fraction of a paisa |
| Voiceover | **2 per 30 s** (per started 400 characters) | Sarvam Bulbul v3: ₹30 per 10,000 characters ≈ ₹1.20 per 30 s |
| Scenes, clip swaps, previews | free | Pixabay is free; previews run in the browser |
| Export, stock footage or voiceover video | **3 per 30 s** (×2 for 4K) | FFmpeg render, storage and bandwidth |
| Export, animated (Motion Explainer) | **5 per 30 s** (×2 for 4K) | Headless Chrome render, which is heavier |
| Talking presenter, stock | **160 per 30 s**, reused on re-exports | HeyGen Avatar IV studio avatar ≈ $4.83/min ≈ ₹204 per 30 s. (Was 50 until 2026-11-23, which lost money.) |
| Talking presenter, your photo avatar | **80 per 30 s**, reused on re-exports | HeyGen Avatar IV photo avatar ≈ $2.31/min ≈ ₹98 per 30 s |
| Create your photo avatar | **80, once** (refunded if it fails) | HeyGen photo avatar creation ≈ $1.32 ≈ ₹112 |
| Corrections | **free for the next 2 re-exports of each video** (export part only; a new presenter video is still charged) | Our own render time, ≈ ₹1–5 |
| AI Video Editor, first render | **5 per minute** of footage | Deepgram ≈ ₹0.36/min, Gemini and the render |
| AI Video Editor, re-render | **2 per minute** | The transcript is reused, so only the render is charged |

Example: a 30-second stock-footage faceless video costs 2 + 3 = **5 credits**, which is ₹7–12 depending on the
plan. Changing the captions and exporting again costs 3 more.

## Where to change it

- Prices: `server/src/config/credits.ts`. Change `CREDIT_COSTS` only; `PRICE_LIST` and the web app follow automatically.
- Plans and packs: `server/src/config/plans.ts`. Free credits come from `FREE_PLAN_CREDITS` (default 30).
