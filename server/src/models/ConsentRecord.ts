import { Schema, model, type HydratedDocument, type InferSchemaType, Types } from 'mongoose';

export const CONSENT_STATUSES = ['awaiting_subject', 'active', 'revoked'] as const;

/**
 * Evidence that a person agreed to an AI copy of their voice (or likeness, later).
 * Kept after revocation as a record of who consented, when and how — the biometric recordings
 * themselves are deleted on revocation.
 */
const consentSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['voice'], required: true },
    relationship: { type: String, enum: ['self', 'other'], required: true },
    subjectName: { type: String, required: true, trim: true, maxlength: 80 },
    subjectEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    /** The exact words the person had to say. */
    statementText: { type: String, required: true, maxlength: 600 },
    statementAssetId: { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
    /** What speech-to-text heard in the recording, and how much of the statement it matched (0–1). */
    statementTranscript: { type: String, default: '', maxlength: 2000 },
    statementMatch: { type: Number, default: 0 },
    attestations: {
      rightsAndConsent: { type: Boolean, required: true },
      notPublicFigure: { type: Boolean, required: true },
      acceptsUsePolicy: { type: Boolean, required: true },
    },
    status: { type: String, enum: CONSENT_STATUSES, required: true },
    grantedAt: { type: Date, default: null },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '', maxlength: 512 },
    /** Third-party subjects confirm by email before anything is created. */
    confirmTokenHash: { type: String, default: null },
    confirmExpiresAt: { type: Date, default: null },
    subjectConfirmedAt: { type: Date, default: null },
    subjectConfirmIp: { type: String, default: '' },
    /** Emailed to the subject; works for as long as the consent exists. */
    revokeTokenHash: { type: String, required: true },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: String, enum: ['subject', 'workspace', null], default: null },
  },
  { timestamps: true },
);

consentSchema.index({ workspaceId: 1, createdAt: -1 });
consentSchema.index({ confirmTokenHash: 1 }, { unique: true, partialFilterExpression: { confirmTokenHash: { $type: 'string' } } });
consentSchema.index({ revokeTokenHash: 1 }, { unique: true });

export type ConsentDoc = HydratedDocument<InferSchemaType<typeof consentSchema>>;
export const ConsentRecord = model('ConsentRecord', consentSchema);

export function toPublicConsent(c: ConsentDoc) {
  return {
    id: (c._id as Types.ObjectId).toString(),
    kind: c.kind,
    relationship: c.relationship,
    subjectName: c.subjectName,
    subjectEmail: c.subjectEmail,
    statementText: c.statementText,
    statementMatch: c.statementMatch,
    status: c.status,
    grantedAt: c.grantedAt,
    subjectConfirmedAt: c.subjectConfirmedAt,
    revokedAt: c.revokedAt,
    revokedBy: c.revokedBy,
    createdAt: c.get('createdAt') as Date,
  };
}
