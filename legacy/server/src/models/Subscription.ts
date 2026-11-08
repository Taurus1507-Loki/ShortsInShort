import mongoose, { Schema, Document } from 'mongoose';
import { PlanTier } from './User.js';

export interface IPlanDefinition {
  id: PlanTier;
  name: string;
  priceInrMonthly: number;
  priceInrAnnual: number;
  monthlyCredits: number;
  maxResolution: '720p' | '1080p' | '4k';
  features: string[];
  hasWatermark: boolean;
  avatarAccess: boolean;
  brollAccess: boolean;
  teamMembersLimit: number;
}

export const PLAN_CONFIGS: Record<PlanTier, IPlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free Starter',
    priceInrMonthly: 0,
    priceInrAnnual: 0,
    monthlyCredits: 10,
    maxResolution: '720p',
    features: ['10 Free Credits', 'Standard 720p Export', 'Basic Templates', 'ShortsInShort Watermark'],
    hasWatermark: true,
    avatarAccess: false,
    brollAccess: false,
    teamMembersLimit: 1,
  },
  starter: {
    id: 'starter',
    name: 'Starter Plan',
    priceInrMonthly: 499,
    priceInrAnnual: 4790,
    monthlyCredits: 20,
    maxResolution: '1080p',
    features: ['20 Video Credits / mo', 'Full 1080p HD Export', 'Basic AI Editing & Captions', 'Standard B-roll Matching', 'No Watermark'],
    hasWatermark: false,
    avatarAccess: false,
    brollAccess: true,
    teamMembersLimit: 1,
  },
  creator: {
    id: 'creator',
    name: 'Creator Plan',
    priceInrMonthly: 999,
    priceInrAnnual: 9590,
    monthlyCredits: 50,
    maxResolution: '1080p',
    features: ['50 Video Credits / mo', 'AI Avatar Access', 'Submagic-style Animated Captions', 'Automated Silence Trimming', 'Dynamic Zooms & Sound FX', 'Brand Kit Customization'],
    hasWatermark: false,
    avatarAccess: true,
    brollAccess: true,
    teamMembersLimit: 2,
  },
  pro: {
    id: 'pro',
    name: 'Pro Studio Plan',
    priceInrMonthly: 1999,
    priceInrAnnual: 19190,
    monthlyCredits: 120,
    maxResolution: '4k',
    features: ['120 Video Credits / mo', '4K Ultra-HD Export', 'High-Priority Queue Processing', 'Custom Voices & Cloned Avatars', 'Multi-layer Motion Graphics', '3 Brand Kits'],
    hasWatermark: false,
    avatarAccess: true,
    brollAccess: true,
    teamMembersLimit: 5,
  },
  agency: {
    id: 'agency',
    name: 'Agency & Studio',
    priceInrMonthly: 4999,
    priceInrAnnual: 47990,
    monthlyCredits: 350,
    maxResolution: '4k',
    features: ['350 Video Credits / mo', 'Dedicated GPU Render Cluster', 'Unlimited Client Workspaces', '15 Team Members', 'Custom API Webhooks', 'Dedicated Account Manager'],
    hasWatermark: false,
    avatarAccess: true,
    brollAccess: true,
    teamMembersLimit: 15,
  },
};

export interface ISubscription extends Document {
  userId: mongoose.Types.ObjectId;
  planId: PlanTier;
  razorpaySubscriptionId?: string;
  razorpayCustomerId?: string;
  billingCycle: 'monthly' | 'annual';
  currency: string;
  amount: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  status: 'active' | 'pending' | 'canceled' | 'past_due' | 'halted';
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    planId: {
      type: String,
      enum: ['free', 'starter', 'creator', 'pro', 'agency'],
      required: true,
    },
    razorpaySubscriptionId: { type: String, sparse: true, index: true },
    razorpayCustomerId: { type: String },
    billingCycle: { type: String, enum: ['monthly', 'annual'], default: 'monthly' },
    currency: { type: String, default: 'INR' },
    amount: { type: Number, required: true },
    currentPeriodStart: { type: Date, default: Date.now },
    currentPeriodEnd: { type: Date },
    status: {
      type: String,
      enum: ['active', 'pending', 'canceled', 'past_due', 'halted'],
      default: 'active',
    },
    cancelAtPeriodEnd: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

export const Subscription = mongoose.model<ISubscription>('Subscription', SubscriptionSchema);

