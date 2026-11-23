/**
 * Credit pricing: flat prices per finished video, on par with the market (1 credit ≈ ₹1; plans
 * ₹0.83–1.00 per credit). Decided 2026-11-23:
 *   Edit my video (AI Video Editor, Auto edit): 499 up to 1 min of footage, 600 up to 3 min, +200 per extra minute.
 *   Faceless reel (stock footage or animated): 799 up to 2 min, +399 per extra minute.
 *   Talking presenter video (your photo avatar or a stock presenter): 999 per started minute, everything included.
 *   Corrections: the next 2 re-exports of the same video are free, then 49 each.
 *   Analysis, scripts, scene planning and previews are free.
 * A voiceover is charged when it's made (so redoing it many times isn't free) and its credits are
 * deducted from the video's price at the first export, so the video costs exactly its flat price.
 *
 * Our costs behind it (2026-11): voiceover ≈ ₹1.20 / 30 s (Sarvam), transcription ≈ ₹0.36 / min (Deepgram),
 * rendering ≈ ₹1–5 per video, HeyGen presenter ≈ ₹195–408 / min, photo avatar creation ≈ ₹112.
 * Tune here only.
 */
export const CREDIT_COSTS = {
  /** Voiceover: per started block of characters (~30 s of speech); deducted from the video price at export. */
  narrationPerBlock: 10,
  /** Edit my video: up to 1 minute of footage, up to 3 minutes, and each minute after that. */
  editUpTo1Min: 499,
  editUpTo3Min: 600,
  editPerExtraMin: 200,
  /** Faceless reel (stock or animated, or a voiceover video without a presenter): up to 2 minutes, then per minute. */
  reelUpTo2Min: 799,
  reelPerExtraMin: 399,
  /** Talking presenter video: per started minute, everything included. */
  presenterPerMin: 999,
  /** Creating your photo avatar (once; refunded if it fails). */
  photoAvatarCreate: 199,
  /** A correction after the free ones. */
  correction: 49,
  /** Multiplier for 4K exports. */
  resolutionMultiplier: { '720p': 1, '1080p': 1, '4k': 1.5 } as Record<string, number>,
} as const;

/** Free corrections: re-exports of the same video after its first export. */
export const FREE_CORRECTIONS_PER_VIDEO = 2;

/** Characters in one voiceover block (≈ 30 s of speech). */
export const NARRATION_CHARS_PER_BLOCK = 400;
/** Longest script one voiceover accepts (≈ 6 minutes of speech). */
export const MAX_NARRATION_CHARS = 5000;

const resMult = (resolution: string) => CREDIT_COSTS.resolutionMultiplier[resolution] ?? 1;
const extraMinutes = (durationSec: number, includedSec: number) => Math.max(0, Math.ceil((durationSec - includedSec) / 60));

export function narrationCreditCost(characters: number): number {
  return Math.max(1, Math.ceil(characters / NARRATION_CHARS_PER_BLOCK)) * CREDIT_COSTS.narrationPerBlock;
}

/** Edit my video: by the length of the footage. */
export function editorVideoCost(sourceDurationSec: number, resolution = '1080p'): number {
  const base =
    sourceDurationSec <= 60
      ? CREDIT_COSTS.editUpTo1Min
      : sourceDurationSec <= 180
        ? CREDIT_COSTS.editUpTo3Min
        : CREDIT_COSTS.editUpTo3Min + extraMinutes(sourceDurationSec, 180) * CREDIT_COSTS.editPerExtraMin;
  return Math.round(base * resMult(resolution));
}

/** Faceless reel (stock or animated) or a voiceover video without a presenter: by the voiceover's length. */
export function reelCost(durationSec: number, resolution = '1080p'): number {
  const base = CREDIT_COSTS.reelUpTo2Min + extraMinutes(durationSec, 120) * CREDIT_COSTS.reelPerExtraMin;
  return Math.round(base * resMult(resolution));
}

/** Talking presenter video (your photo avatar or a stock presenter): per started minute. */
export function presenterVideoCost(durationSec: number, resolution = '1080p'): number {
  return Math.round(Math.max(1, Math.ceil(durationSec / 60)) * CREDIT_COSTS.presenterPerMin * resMult(resolution));
}

/** One line per priced item, for the pricing page, the calculator and the step pages. */
export const PRICE_LIST = [
  { step: 'script', label: 'Script written by AI', credits: 0, unit: 'free' },
  { step: 'voice', label: 'Voiceover (deducted from the video price)', credits: CREDIT_COSTS.narrationPerBlock, unit: 'per 30 s' },
  { step: 'scenes', label: 'Scenes and clip swaps', credits: 0, unit: 'free' },
  { step: 'export', label: 'Faceless reel, stock footage (up to 2 min)', credits: CREDIT_COSTS.reelUpTo2Min, unit: 'per video' },
  { step: 'export_motion', label: 'Faceless reel, animated (up to 2 min)', credits: CREDIT_COSTS.reelUpTo2Min, unit: 'per video' },
  { step: 'reel_extra_min', label: 'Faceless reel, each minute over 2', credits: CREDIT_COSTS.reelPerExtraMin, unit: 'per minute' },
  { step: 'presenter', label: 'Talking presenter video (stock)', credits: CREDIT_COSTS.presenterPerMin, unit: 'per minute' },
  { step: 'presenter_photo', label: 'Talking presenter video (your photo avatar)', credits: CREDIT_COSTS.presenterPerMin, unit: 'per minute' },
  { step: 'photo_avatar', label: 'Create your photo avatar', credits: CREDIT_COSTS.photoAvatarCreate, unit: 'once' },
  { step: 'editor', label: 'Edit my video (up to 1 min of footage)', credits: CREDIT_COSTS.editUpTo1Min, unit: 'per video' },
  { step: 'editor_3min', label: 'Edit my video (up to 3 min of footage)', credits: CREDIT_COSTS.editUpTo3Min, unit: 'per video' },
  { step: 'editor_extra_min', label: 'Edit my video, each minute over 3', credits: CREDIT_COSTS.editPerExtraMin, unit: 'per minute' },
  { step: 'editor_analyze', label: 'Analyse footage and Auto edit', credits: 0, unit: 'free' },
  { step: 'correction', label: 'Corrections: the next 2 re-exports of each video', credits: 0, unit: 'free' },
  { step: 'correction_paid', label: 'Corrections after the free ones', credits: CREDIT_COSTS.correction, unit: 'per re-export' },
] as const;

const RES_RANK: Record<string, number> = { '720p': 1, '1080p': 2, '4k': 3 };
export const resolutionAllowed = (requested: string, planMax: string) => (RES_RANK[requested] ?? 9) <= (RES_RANK[planMax] ?? 0);
