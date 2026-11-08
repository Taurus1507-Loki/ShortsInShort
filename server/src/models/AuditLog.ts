import { Schema, model } from 'mongoose';

/** Security-relevant events (sign-ins, password changes, deletions, role changes). */
const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
    action: { type: String, required: true, maxlength: 80 },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '', maxlength: 512 },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLog = model('AuditLog', auditLogSchema);
