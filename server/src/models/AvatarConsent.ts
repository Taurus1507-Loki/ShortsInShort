import mongoose, { Schema, Document } from 'mongoose';

export type ConsentStatus = 'pending_verification' | 'active' | 'revoked' | 'rejected';

export interface IAvatarConsent extends Document {
  userId: mongoose.Types.ObjectId;
  avatarName: string;
  provider: 'heygen' | 'd_id' | 'synclabs' | 'elevenlabs';
  externalAvatarId?: string;
  externalVoiceId?: string;
  profileImageUrl: string;
  voiceSampleUrl?: string;
  explicitConsentGiven: boolean;
  legalDeclarationSigned: boolean;
  consentTimestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  status: ConsentStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AvatarConsentSchema = new Schema<IAvatarConsent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    avatarName: { type: String, required: true },
    provider: {
      type: String,
      enum: ['heygen', 'd_id', 'synclabs', 'elevenlabs'],
      default: 'heygen',
    },
    externalAvatarId: { type: String },
    externalVoiceId: { type: String },
    profileImageUrl: { type: String, required: true },
    voiceSampleUrl: { type: String },
    explicitConsentGiven: { type: Boolean, required: true },
    legalDeclarationSigned: { type: Boolean, required: true },
    consentTimestamp: { type: Date, default: Date.now },
    ipAddress: { type: String },
    userAgent: { type: String },
    status: {
      type: String,
      enum: ['pending_verification', 'active', 'revoked', 'rejected'],
      default: 'active',
      index: true,
    },
    notes: { type: String },
  },
  {
    timestamps: true,
  }
);

export const AvatarConsent = mongoose.model<IAvatarConsent>('AvatarConsent', AvatarConsentSchema);

