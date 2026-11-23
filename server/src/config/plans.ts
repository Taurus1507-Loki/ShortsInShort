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
  /** Photo avatars (your own face) the workspace can keep. */
  photoAvatars: number;
  /** Brand kits the workspace can keep (agencies: one per client). */
  brandKits: number;
  highlights: string[];
}

const GB = 1024 ** 3;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPricePaise: 0,
    annualPricePaise: 0,
    monthlyCredits: 800,
    storageBytes: 2 * GB,
    maxResolution: '720p',
    watermark: true,
    customVoices: 0,
    photoAvatars: 0,
    brandKits: 1,
    highlights: ['1 free video (800 credits) after email verification', '720p exports', 'Watermarked output'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    monthlyPricePaise: 499_00,
    annualPricePaise: 4_990_00,
    monthlyCredits: 500,
    storageBytes: 10 * GB,
    maxResolution: '1080p',
    watermark: false,
    customVoices: 1,
    photoAvatars: 1,
    brandKits: 1,
    highlights: ['500 credits / month — 1 edited video', '1080p exports', 'No watermark', 'Brand Kit'],
  },
  creator: {
    id: 'creator',
    name: 'Creator',
    monthlyPricePaise: 999_00,
    annualPricePaise: 9_990_00,
    monthlyCredits: 1100,
    storageBytes: 25 * GB,
    maxResolution: '1080p',
    watermark: false,
    customVoices: 3,
    photoAvatars: 3,
    brandKits: 3,
    highlights: ['1,100 credits / month — 2 edited videos or a faceless reel', 'Everything in Starter', 'Faceless videos', 'Priority queue'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyPricePaise: 1_999_00,
    annualPricePaise: 19_990_00,
    monthlyCredits: 2300,
    storageBytes: 60 * GB,
    maxResolution: '4k',
    watermark: false,
    customVoices: 5,
    photoAvatars: 5,
    brandKits: 5,
    highlights: ['2,300 credits / month — about 3 faceless reels', 'AI Avatar Studio', '4K where supported', 'Premium AI models'],
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    monthlyPricePaise: 4_999_00,
    annualPricePaise: 49_990_00,
    monthlyCredits: 6000,
    storageBytes: 200 * GB,
    maxResolution: '4k',
    watermark: false,
    customVoices: 10,
    photoAvatars: 10,
    brandKits: 25,
    highlights: ['6,000 credits / month — about 12 edited videos', 'Team members', '25 brand kits', 'Dedicated support'],
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
  { id: 'pack_500', credits: 500, pricePaise: 599_00 },
  { id: 'pack_1000', credits: 1000, pricePaise: 1_099_00 },
  { id: 'pack_2500', credits: 2500, pricePaise: 2_599_00 },
  { id: 'pack_6000', credits: 6000, pricePaise: 5_999_00 },
];

/** Paid plans that can be subscribed to (Free has no subscription). */
export const PAID_PLAN_IDS = PLAN_IDS.filter((id) => PLANS[id].monthlyPricePaise > 0);
