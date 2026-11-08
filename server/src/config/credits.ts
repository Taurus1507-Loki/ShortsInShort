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

export function editorCreditCost(sourceDurationSec: number, resolution: string): number {
  const minutes = Math.max(1, Math.ceil(sourceDurationSec / 60));
  return minutes * CREDIT_COSTS.editorPerSourceMinute * (CREDIT_COSTS.resolutionMultiplier[resolution] ?? 1);
}

const RES_RANK: Record<string, number> = { '720p': 1, '1080p': 2, '4k': 3 };
export const resolutionAllowed = (requested: string, planMax: string) => (RES_RANK[requested] ?? 9) <= (RES_RANK[planMax] ?? 0);
