/**
 * Plan catalogue. Prices are BUSINESS ASSUMPTIONS from the product brief, not final prices.
 * Amounts are in paise (INR × 100) to avoid floating point. Razorpay plan IDs are attached in Phase 5.
 */
export type PlanId = 'free' | 'starter' | 'creator' | 'pro' | 'agency';

export interface Plan {
  id: PlanId;
  name: string;
  monthlyPricePaise: number;
  /** Annual price (≈ 2 months free). */
  annualPricePaise: number;
  monthlyCredits: number;
  storageBytes: number;
  maxResolution: '720p' | '1080p' | '4k';
  watermark: boolean;
  /** Consented custom (cloned) voices the workspace can keep at once. */
  customVoices: number;
  highlights: string[];
}

const GB = 1024 ** 3;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPricePaise: 0,
    annualPricePaise: 0,
    monthlyCredits: 3,
    storageBytes: 2 * GB,
    maxResolution: '720p',
    watermark: true,
    customVoices: 0,
    highlights: ['3 credits after email verification', '720p exports', 'Watermarked output'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    monthlyPricePaise: 499_00,
    annualPricePaise: 4_990_00,
    monthlyCredits: 20,
    storageBytes: 10 * GB,
    maxResolution: '1080p',
    watermark: false,
    customVoices: 1,
    highlights: ['20 credits / month', '1080p exports', 'No watermark', 'Brand Kit'],
  },
  creator: {
    id: 'creator',
    name: 'Creator',
    monthlyPricePaise: 999_00,
    annualPricePaise: 9_990_00,
    monthlyCredits: 50,
    storageBytes: 25 * GB,
    maxResolution: '1080p',
    watermark: false,
    customVoices: 3,
    highlights: ['50 credits / month', 'Everything in Starter', 'Faceless videos', 'Priority queue'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyPricePaise: 1_999_00,
    annualPricePaise: 19_990_00,
    monthlyCredits: 120,
    storageBytes: 60 * GB,
    maxResolution: '4k',
    watermark: false,
    customVoices: 5,
    highlights: ['120 credits / month', 'AI Avatar Studio', '4K where supported', 'Premium AI models'],
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    monthlyPricePaise: 4_999_00,
    annualPricePaise: 49_990_00,
    monthlyCredits: 350,
    storageBytes: 200 * GB,
    maxResolution: '4k',
    watermark: false,
    customVoices: 10,
    highlights: ['350 credits / month', 'Team members', 'Multiple brand kits', 'Dedicated support'],
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/** One-time credit top-ups (prices in paise, GST as configured). Subscriptions stay cheaper per credit. */
export interface CreditPack {
  id: string;
  credits: number;
  pricePaise: number;
}
export const CREDIT_PACKS: CreditPack[] = [
  { id: 'pack_10', credits: 10, pricePaise: 299_00 },
  { id: 'pack_25', credits: 25, pricePaise: 699_00 },
  { id: 'pack_60', credits: 60, pricePaise: 1_499_00 },
  { id: 'pack_150', credits: 150, pricePaise: 3_499_00 },
];

/** Paid plans that can be subscribed to (Free has no subscription). */
export const PAID_PLAN_IDS = PLAN_IDS.filter((id) => PLANS[id].monthlyPricePaise > 0);
