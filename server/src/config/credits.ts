/**
 * Credit pricing. Configurable business assumptions — tune once real provider costs are measured.
 * Displayed to the user before every generation.
 */
export const CREDIT_COSTS = {
  /** AI Video Editor: per started minute of SOURCE footage (minimum 1). */
  editorPerSourceMinute: 1,
  /** Multiplier for 4K exports. */
  resolutionMultiplier: { '720p': 1, '1080p': 1, '4k': 2 } as Record<string, number>,
} as const;

/** Avatar Studio voiceover: 1 credit per started block of characters (~30 s of speech). */
export const NARRATION_CHARS_PER_CREDIT = 400;
/** Longest script one voiceover accepts (≈ 6 minutes of speech). */
export const MAX_NARRATION_CHARS = 5000;

export function narrationCreditCost(characters: number): number {
  return Math.max(1, Math.ceil(characters / NARRATION_CHARS_PER_CREDIT));
}

/** Talking presenter: provider cost dominates (≈₹15–80/min), so 5 credits per started 30 s of voiceover. */
export const AVATAR_CREDITS_PER_30S = 5;
export const avatarCreditCost = (durationSec: number) => Math.max(1, Math.ceil(durationSec / 30)) * AVATAR_CREDITS_PER_30S;

export function editorCreditCost(sourceDurationSec: number, resolution: string): number {
  const minutes = Math.max(1, Math.ceil(sourceDurationSec / 60));
  return minutes * CREDIT_COSTS.editorPerSourceMinute * (CREDIT_COSTS.resolutionMultiplier[resolution] ?? 1);
}

const RES_RANK: Record<string, number> = { '720p': 1, '1080p': 2, '4k': 3 };
export const resolutionAllowed = (requested: string, planMax: string) => (RES_RANK[requested] ?? 9) <= (RES_RANK[planMax] ?? 0);
