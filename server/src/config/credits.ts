/**
 * Credit pricing, charged per step: each step that costs real money is charged when it runs, and
 * redoing one step charges only that step. Writing scripts, planning and swapping scenes, and
 * previews are free.
 *
 * 1 credit ≈ ₹1.43 (Agency) to ₹2.50 (Starter). Prices are set from measured provider costs so a
 * step costs about 2× what it costs us, and stays light for users. Tune here only.
 *   Voiceover — Sarvam Bulbul v3: ₹30 / 10,000 characters → ~₹1.20 per 30 s (≈400 characters).
 *   Rendering — our own servers (FFmpeg; headless Chrome for Motion Explainer) plus storage and bandwidth.
 *   Transcription — Deepgram ≈ ₹0.36 per minute (charged once per source; re-renders reuse it).
 *   Talking presenter — HeyGen, the most expensive provider (recheck against the live price).
 */
export const CREDIT_COSTS = {
  /** Voiceover: per started block of characters (~30 s of speech). */
  narrationPerBlock: 2,
  /** Stock-footage faceless video, or a voiceover over a background: per started 30 s. */
  exportPer30s: 3,
  /** Motion Explainer (headless-browser rendering): per started 30 s. */
  motionExportPer30s: 5,
  /** Talking presenter (HeyGen): per started 30 s of voiceover. */
  presenterPer30s: 50,
  /** AI Video Editor, first render of a source: transcription + AI + render, per started source minute. */
  editorPerSourceMinute: 5,
  /** AI Video Editor re-render: the transcript is reused, so only rendering is charged. */
  editorRerenderPerSourceMinute: 2,
  /** Multiplier for 4K exports. */
  resolutionMultiplier: { '720p': 1, '1080p': 1, '4k': 2 } as Record<string, number>,
} as const;

/** Characters in one voiceover block (≈ 30 s of speech). */
export const NARRATION_CHARS_PER_BLOCK = 400;
/** Longest script one voiceover accepts (≈ 6 minutes of speech). */
export const MAX_NARRATION_CHARS = 5000;

const per30s = (durationSec: number) => Math.max(1, Math.ceil(durationSec / 30));
const resMult = (resolution: string) => CREDIT_COSTS.resolutionMultiplier[resolution] ?? 1;

export function narrationCreditCost(characters: number): number {
  return Math.max(1, Math.ceil(characters / NARRATION_CHARS_PER_BLOCK)) * CREDIT_COSTS.narrationPerBlock;
}

export const avatarCreditCost = (durationSec: number) => per30s(durationSec) * CREDIT_COSTS.presenterPer30s;

/** Exporting a voiced video (stock faceless, or a voiceover over a background). */
export const facelessCreditCost = (durationSec: number, resolution: string) => per30s(durationSec) * CREDIT_COSTS.exportPer30s * resMult(resolution);

/** Motion Explainer export. */
export const motionCreditCost = (durationSec: number, resolution: string) => per30s(durationSec) * CREDIT_COSTS.motionExportPer30s * resMult(resolution);

/** AI Video Editor: cheaper when the source was already transcribed (a re-render). */
export function editorCreditCost(sourceDurationSec: number, resolution: string, transcribed = false): number {
  const minutes = Math.max(1, Math.ceil(sourceDurationSec / 60));
  const rate = transcribed ? CREDIT_COSTS.editorRerenderPerSourceMinute : CREDIT_COSTS.editorPerSourceMinute;
  return minutes * rate * resMult(resolution);
}

/** One line per priced step, for the pricing page and the step pages. */
export const PRICE_LIST = [
  { step: 'script', label: 'Script written by AI', credits: 0, unit: 'free' },
  { step: 'voice', label: 'Voiceover', credits: CREDIT_COSTS.narrationPerBlock, unit: 'per 30 s' },
  { step: 'scenes', label: 'Scenes and clip swaps', credits: 0, unit: 'free' },
  { step: 'export', label: 'Export, stock clips or voiceover video', credits: CREDIT_COSTS.exportPer30s, unit: 'per 30 s' },
  { step: 'export_motion', label: 'Export, animated (Motion Explainer)', credits: CREDIT_COSTS.motionExportPer30s, unit: 'per 30 s' },
  { step: 'presenter', label: 'Talking presenter', credits: CREDIT_COSTS.presenterPer30s, unit: 'per 30 s' },
  { step: 'editor', label: 'AI Video Editor, first render', credits: CREDIT_COSTS.editorPerSourceMinute, unit: 'per minute of footage' },
  { step: 'editor_rerender', label: 'AI Video Editor, re-render', credits: CREDIT_COSTS.editorRerenderPerSourceMinute, unit: 'per minute of footage' },
] as const;

const RES_RANK: Record<string, number> = { '720p': 1, '1080p': 2, '4k': 3 };
export const resolutionAllowed = (requested: string, planMax: string) => (RES_RANK[requested] ?? 9) <= (RES_RANK[planMax] ?? 0);
