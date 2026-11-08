import mongoose, { Schema, Document } from 'mongoose';

export type UserRole = 'super_admin' | 'admin' | 'customer' | 'team_member';
export type PlanTier = 'free' | 'starter' | 'creator' | 'pro' | 'agency';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing' | 'none';

export interface IBrandKit {
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  captionStyle: string;
  watermarkUrl?: string;
  watermarkPosition: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
}

export interface IUser extends Document {
  fullName: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  workspaceId: mongoose.Types.ObjectId;
  emailVerified: boolean;
  creditBalance: number;
  planTier: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  currentSubscriptionId?: mongoose.Types.ObjectId;
  brandKit: IBrandKit;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['super_admin', 'admin', 'customer', 'team_member'],
      default: 'customer',
      index: true,
    },
    workspaceId: { type: Schema.Types.ObjectId, index: true },
    emailVerified: { type: Boolean, default: false },
    creditBalance: { type: Number, default: 50, min: 0 },
    planTier: {
      type: String,
      enum: ['free', 'starter', 'creator', 'pro', 'agency'],
      default: 'free',
      index: true,
    },
    subscriptionStatus: {
      type: String,
      enum: ['active', 'past_due', 'canceled', 'trialing', 'none'],
      default: 'none',
    },
    currentSubscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription' },
    brandKit: {
      logoUrl: { type: String },
      primaryColor: { type: String, default: '#d946ef' },
      secondaryColor: { type: String, default: '#3b82f6' },
      fontFamily: { type: String, default: 'Plus Jakarta Sans' },
      captionStyle: { type: String, default: 'karaoke_neon' },
      watermarkUrl: { type: String },
      watermarkPosition: {
        type: String,
        enum: ['top_left', 'top_right', 'bottom_left', 'bottom_right'],
        default: 'top_right',
      },
    },
  },
  {
    timestamps: true,
  }
);

// If workspaceId is not set, set it to the user's own _id on creation
UserSchema.pre('save', function (next) {
  if (!this.workspaceId) {
    this.workspaceId = this._id as mongoose.Types.ObjectId;
  }
  next();
});

export const User = mongoose.model<IUser>('User', UserSchema);

