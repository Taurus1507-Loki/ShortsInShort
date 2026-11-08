import { Schema, model, type HydratedDocument, type InferSchemaType, Types } from 'mongoose';

export const ROLES = ['super_admin', 'admin', 'customer', 'team_member'] as const;
export type Role = (typeof ROLES)[number];
export const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    /** Null for Google-only accounts. Never selected by default. */
    passwordHash: { type: String, default: null, select: false },
    fullName: { type: String, required: true, trim: true, maxlength: 80 },
    role: { type: String, enum: ROLES, default: 'customer', required: true },
    status: { type: String, enum: USER_STATUSES, default: 'active', required: true },
    emailVerifiedAt: { type: Date, default: null },
    googleId: { type: String, default: undefined },
    avatarUrl: { type: String, default: null, maxlength: 2048 },
    defaultWorkspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } });

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);

export function toPublicUser(u: UserDoc) {
  return {
    id: (u._id as Types.ObjectId).toString(),
    email: u.email,
    fullName: u.fullName,
    role: u.role as Role,
    emailVerified: Boolean(u.emailVerifiedAt),
    avatarUrl: u.avatarUrl,
    hasPassword: Boolean(u.passwordHash),
    googleLinked: Boolean(u.googleId),
    defaultWorkspaceId: u.defaultWorkspaceId.toString(),
    createdAt: u.get('createdAt') as Date,
  };
}
