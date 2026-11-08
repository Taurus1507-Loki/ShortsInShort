import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../config/logger.js';

export async function audit(
  req: Request | null,
  action: string,
  opts: { actorId?: Types.ObjectId | string | null; workspaceId?: Types.ObjectId | string | null; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await AuditLog.create({
      action,
      actorId: opts.actorId ?? null,
      workspaceId: opts.workspaceId ?? null,
      ip: req?.ip ?? '',
      userAgent: req?.get('user-agent')?.slice(0, 512) ?? '',
      metadata: opts.metadata ?? {},
    });
  } catch (err) {
    // Audit failures are logged but never block the user-facing action.
    logger.error({ err, action }, 'Failed to write audit log');
  }
}
