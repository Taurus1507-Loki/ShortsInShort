import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const AUTH_TOKEN_TYPES = ['email_verify', 'password_reset'] as const;
export type AuthTokenType = (typeof AUTH_TOKEN_TYPES)[number];

/** Single-use tokens for email verification and password reset. Only the hash is stored. */
const authTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: AUTH_TOKEN_TYPES, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

authTokenSchema.index({ tokenHash: 1 }, { unique: true });
authTokenSchema.index({ userId: 1, type: 1 });
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AuthTokenDoc = HydratedDocument<InferSchemaType<typeof authTokenSchema>>;
export const AuthToken = model('AuthToken', authTokenSchema);
