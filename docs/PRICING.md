# Credits and the step-by-step flow (prices updated 2026-11-23)

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

## Credit unit (changed 2026-11-23: flat per-video prices, 1 credit ≈ ₹1)

| Plan | ₹ / month | Credits | ₹ per credit |
|---|---|---|---|
| Free | 0 | 800 once, after verification (1 free watermarked video) | — |
| Starter | 499 | 500 | 1.00 |
| Creator | 999 | 1,100 | 0.91 |
| Pro | 1,999 | 2,300 | 0.87 |
| Agency | 4,999 | 6,000 | 0.83 |

Top-ups: 500 credits for ₹599, 1,000 for ₹1,099, 2,500 for ₹2,599, 6,000 for ₹5,999. Plan prices include 18% GST.
Existing balances were multiplied by 2.5 (migration `2026-11-23-per-video-prices`) so they kept their rupee value.

## Price per video (on par with ReelsDone)

| Video | Credits | Our cost behind it | Profit (Agency → Starter, after GST and Razorpay) |
|---|---|---|---|
| Edit my video (Auto edit) | **499** up to 1 min of footage, **600** up to 3 min, +200 per extra minute | Deepgram ≈ ₹0.36/min, Gemini, render ≈ ₹3–6 | ≈ ₹340 → ₹405 |
| Faceless reel, stock or animated | **799** up to 2 min, +399 per extra minute | Sarvam ≈ ₹1.20/30 s, render ≈ ₹2–7 | ≈ ₹545 → ₹645 |
| Talking presenter video (your photo avatar or stock) | **999 per minute**, everything included | HeyGen ≈ ₹195 (photo) – ₹408 (stock) per minute | ≈ ₹280 → ₹600 (stock), more with a photo avatar |
| Voiceover | 10 per 30 s, charged when made and **deducted from the video price** at the first export | Sarvam ≈ ₹1.20 per 30 s | — |
| Create your photo avatar | **199, once** (refunded if it fails) | HeyGen ≈ ₹112 | |
| Corrections | **2 free per video, then 49** — only for the same video (same footage, or same voiceover and presenter); a new script, voiceover or footage is a new video | Our render time, ≈ ₹1–5 | |
| Analysing footage, Auto edit planning, scripts, scenes, previews | free | Deepgram, Gemini: under ₹2 | |
| 4K | ×1.5 | | |

Example: a 60-second faceless reel costs 799 credits — ₹663 on Agency, ₹799 on Starter.

## Where to change it

- Prices: `server/src/config/credits.ts`. Change `CREDIT_COSTS` only; `PRICE_LIST` and the web app follow automatically.
- Plans and packs: `server/src/config/plans.ts`. Free credits come from `FREE_PLAN_CREDITS` (default 30).
