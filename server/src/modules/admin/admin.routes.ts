import { Router, type Request } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate, validatedQuery } from '../../middleware/validate.js';
import { adminLimiter } from '../../middleware/security.js';
import { AppError, asyncHandler, badRequest, forbidden, notFound } from '../../utils/errors.js';
import { PLAN_IDS, PLANS, type PlanId } from '../../config/plans.js';
import { User, ROLES, type Role } from '../../models/User.js';
import { Workspace } from '../../models/Workspace.js';
import { Project } from '../../models/Project.js';
import { Job } from '../../models/Job.js';
import { Session } from '../../models/Session.js';
import { AuditLog } from '../../models/AuditLog.js';
import { CreditTransaction } from '../../models/CreditTransaction.js';
import { Asset } from '../../models/Asset.js';
import { ConsentRecord, toPublicConsent } from '../../models/ConsentRecord.js';
import { CustomVoice } from '../../models/CustomVoice.js';
import { Invoice, Payment, Subscription, WebhookEvent, LIVE_SUBSCRIPTION_STATUSES } from '../../models/Billing.js';
import { applyCreditChange } from '../../services/credit.service.js';
import { audit } from '../../services/audit.service.js';
import { revokeConsent } from '../../services/voice/consent.js';
import { dailySeries } from '../../services/admin/metrics.js';

/**
 * Admin console API. Every route needs an admin role; every change needs a reason and is written to
 * the audit log. Only a super admin can act on other admins or change roles.
 */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin', 'super_admin'), adminLimiter);

const idParams = z.object({ id: z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id') });
const reason = z.string().trim().min(3, 'Give a reason (it goes in the audit log).').max(300);
const page = { page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) };
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const since = (days: number) => new Date(Date.now() - days * 86_400_000);
const actor = (req: Request) => req.auth!.user;

/** Admins may only act on customers; super admins on anyone except themselves (for safety-critical actions). */
function assertCanManage(req: Request, target: { _id: Types.ObjectId; role: string }) {
  const me = actor(req);
  if (target._id.equals(me._id)) throw forbidden('You can’t do this to your own account.', 'SELF_ACTION');
  if ((target.role === 'admin' || target.role === 'super_admin') && me.role !== 'super_admin') throw forbidden('Only a super admin can manage admin accounts.');
}

/* ── Overview & analytics ───────────────────────────────────────────── */

adminRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const d30 = since(30);
    const d7 = since(7);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [users, verified, suspended, signups7, signups30, plans, liveSubs, revenue30, revenueMonth, credits30, projectsByMode, jobs30, queue, storage, failedWebhooks] = await Promise.all([
      User.countDocuments({ status: { $ne: 'deleted' } }),
      User.countDocuments({ status: { $ne: 'deleted' }, emailVerifiedAt: { $ne: null } }),
      User.countDocuments({ status: 'suspended' }),
      User.countDocuments({ createdAt: { $gte: d7 } }),
      User.countDocuments({ createdAt: { $gte: d30 } }),
      Workspace.aggregate([{ $group: { _id: '$plan', n: { $sum: 1 } } }]),
      Subscription.countDocuments({ status: { $in: ['active', 'authenticated'] } }),
      Payment.aggregate([{ $match: { status: 'paid', paidAt: { $gte: d30 } } }, { $group: { _id: null, paise: { $sum: '$amountPaise' }, n: { $sum: 1 } } }]),
      Payment.aggregate([{ $match: { status: 'paid', paidAt: { $gte: monthStart } } }, { $group: { _id: null, paise: { $sum: '$amountPaise' } } }]),
      CreditTransaction.aggregate([{ $match: { status: 'applied', createdAt: { $gte: d30 } } }, { $group: { _id: '$type', n: { $sum: '$amount' } } }]),
      Project.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: '$mode', n: { $sum: 1 } } }]),
      Job.aggregate([{ $match: { createdAt: { $gte: d30 } } }, { $group: { _id: { type: '$type', status: '$status' }, n: { $sum: 1 } } }]),
      Job.aggregate([{ $match: { status: { $in: ['queued', 'active'] } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Workspace.aggregate([{ $group: { _id: null, bytes: { $sum: '$storageBytesUsed' } } }]),
      WebhookEvent.countDocuments({ processedAt: null, error: { $ne: null } }),
    ]);
    const byKey = (rows: Array<{ _id: string | null; n: number }>) => Object.fromEntries(rows.map((r) => [r._id ?? 'unknown', r.n]));
    const jobs = jobs30 as Array<{ _id: { type: string; status: string }; n: number }>;
    const done = jobs.filter((j) => j._id.status === 'completed').reduce((t, j) => t + j.n, 0);
    const dead = jobs.filter((j) => j._id.status === 'dead').reduce((t, j) => t + j.n, 0);
    res.json({
      data: {
        users: { total: users, verified, suspended, signups7, signups30 },
        plans: byKey(plans),
        subscriptions: { active: liveSubs },
        revenue: { last30Paise: revenue30[0]?.paise ?? 0, payments30: revenue30[0]?.n ?? 0, monthPaise: revenueMonth[0]?.paise ?? 0 },
        credits30: byKey(credits30),
        projects: byKey(projectsByMode),
        jobs30: { completed: done, failed: dead, failureRate: done + dead ? Math.round((dead / (done + dead)) * 1000) / 10 : 0, byType: jobs.map((j) => ({ type: j._id.type, status: j._id.status, n: j.n })) },
        queue: byKey(queue),
        storageBytes: storage[0]?.bytes ?? 0,
        failedWebhooks,
      },
    });
  }),
);

adminRouter.get(
  '/metrics',
  validate({ query: z.object({ days: z.coerce.number().int().min(7).max(180).default(30) }) }),
  asyncHandler(async (req, res) => {
    res.json({ data: await dailySeries(validatedQuery<{ days: number }>(req).days) });
  }),
);

/* ── Users ──────────────────────────────────────────────────────────── */

adminRouter.get(
  '/users',
  validate({ query: z.object({ q: z.string().trim().max(100).optional(), status: z.enum(['active', 'suspended', 'deleted']).optional(), ...page }) }),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<{ q?: string; status?: string; page: number; limit: number }>(req);
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.q) filter.$or = [{ email: { $regex: escapeRegex(q.q), $options: 'i' } }, { fullName: { $regex: escapeRegex(q.q), $options: 'i' } }];
    const [items, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), User.countDocuments(filter)]);
    const wss = await Workspace.find({ _id: { $in: items.map((u) => u.defaultWorkspaceId) } }).select('plan creditBalance storageBytesUsed').lean();
    res.json({
      data: items.map((u) => {
        const ws = wss.find((w) => w._id.equals(u.defaultWorkspaceId));
        return { id: u._id.toString(), email: u.email, fullName: u.fullName, role: u.role, status: u.status, emailVerified: Boolean(u.emailVerifiedAt), plan: ws?.plan ?? 'free', credits: ws?.creditBalance ?? 0, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt };
      }),
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
    });
  }),
);

adminRouter.get(
  '/users/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const u = await User.findById(req.params.id).lean();
    if (!u) throw notFound('User not found.');
    const ws = await Workspace.findById(u.defaultWorkspaceId).lean();
    const [projects, payments, sub, credits, sessions, recentAudit] = await Promise.all([
      Project.aggregate([{ $match: { workspaceId: u.defaultWorkspaceId, deletedAt: null } }, { $group: { _id: '$mode', n: { $sum: 1 } } }]),
      Payment.find({ workspaceId: u.defaultWorkspaceId, status: { $ne: 'created' } }).sort({ createdAt: -1 }).limit(10).lean(),
      Subscription.findOne({ workspaceId: u.defaultWorkspaceId, status: { $in: LIVE_SUBSCRIPTION_STATUSES } }).sort({ createdAt: -1 }).lean(),
      CreditTransaction.find({ workspaceId: u.defaultWorkspaceId, status: 'applied' }).sort({ createdAt: -1 }).limit(15).lean(),
      Session.countDocuments({ userId: u._id, revokedAt: null, expiresAt: { $gt: new Date() } }),
      AuditLog.find({ $or: [{ actorId: u._id }, { 'metadata.targetUserId': u._id.toString() }] }).sort({ createdAt: -1 }).limit(15).lean(),
    ]);
    res.json({
      data: {
        user: { id: u._id.toString(), email: u.email, fullName: u.fullName, role: u.role, status: u.status, emailVerified: Boolean(u.emailVerifiedAt), googleLinked: Boolean(u.googleId), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt },
        workspace: ws ? { id: ws._id.toString(), name: ws.name, plan: ws.plan, credits: ws.creditBalance, storageBytes: ws.storageBytesUsed, billing: ws.billing } : null,
        projects: Object.fromEntries(projects.map((p: { _id: string; n: number }) => [p._id, p.n])),
        subscription: sub ? { planId: sub.planId, period: sub.period, status: sub.status, currentEnd: sub.currentEnd, cancelAtCycleEnd: sub.cancelAtCycleEnd } : null,
        payments: payments.map((p) => ({ id: p._id.toString(), kind: p.kind, status: p.status, amountPaise: p.amountPaise, credits: p.credits, paidAt: p.paidAt, createdAt: p.createdAt })),
        credits: credits.map((c) => ({ type: c.type, amount: c.amount, balanceAfter: c.balanceAfter, note: c.note, createdAt: c.createdAt })),
        activeSessions: sessions,
        audit: recentAudit.map((a) => ({ action: a.action, createdAt: a.createdAt, ip: a.ip, metadata: a.metadata })),
      },
    });
  }),
);

adminRouter.post(
  '/users/:id/credits',
  validate({ params: idParams, body: z.object({ amount: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, 'Amount can’t be zero'), reason, requestId: z.string().uuid() }).strict() }),
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) throw notFound('User not found.');
    // The client's request id makes a double-click (or retry) apply the adjustment once.
    const r = await applyCreditChange({
      workspaceId: target.defaultWorkspaceId,
      type: 'adjust',
      amount: req.body.amount,
      idempotencyKey: `admin:${req.body.requestId}`,
      note: `Admin: ${req.body.reason}`.slice(0, 300),
      actorId: actor(req)._id,
    });
    if (!r.duplicate) await audit(req, 'admin.credits_adjust', { actorId: actor(req)._id, workspaceId: target.defaultWorkspaceId, metadata: { targetUserId: target._id.toString(), amount: req.body.amount, reason: req.body.reason } });
    res.json({ data: { balance: r.balanceAfter, duplicate: r.duplicate } });
  }),
);

adminRouter.post(
  '/users/:id/plan',
  validate({ params: idParams, body: z.object({ plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]), reason }).strict() }),
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) throw notFound('User not found.');
    const live = await Subscription.exists({ workspaceId: target.defaultWorkspaceId, status: { $in: ['active', 'authenticated', 'pending', 'halted'] } });
    if (live) throw new AppError(409, 'HAS_SUBSCRIPTION', 'This workspace has a paid Razorpay subscription — change the plan there (or cancel it) so billing stays in step.');
    const ws = await Workspace.findById(target.defaultWorkspaceId).select('plan');
    const from = ws?.plan;
    await Workspace.updateOne({ _id: target.defaultWorkspaceId }, { $set: { plan: req.body.plan } });
    await audit(req, 'admin.plan_change', { actorId: actor(req)._id, workspaceId: target.defaultWorkspaceId, metadata: { targetUserId: target._id.toString(), from, to: req.body.plan, reason: req.body.reason } });
    res.json({ data: { plan: req.body.plan, planName: PLANS[req.body.plan as PlanId].name } });
  }),
);

adminRouter.post(
  '/users/:id/status',
  validate({ params: idParams, body: z.object({ status: z.enum(['active', 'suspended']), reason }).strict() }),
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) throw notFound('User not found.');
    if (target.status === 'deleted') throw badRequest('This account was deleted.', 'ACCOUNT_DELETED');
    assertCanManage(req, target);
    target.status = req.body.status;
    await target.save();
    // Suspension takes effect immediately: every session is revoked (requests check the session too).
    if (req.body.status === 'suspended') await Session.updateMany({ userId: target._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await audit(req, req.body.status === 'suspended' ? 'admin.user_suspend' : 'admin.user_reactivate', { actorId: actor(req)._id, metadata: { targetUserId: target._id.toString(), reason: req.body.reason } });
    res.json({ data: { status: target.status } });
  }),
);

adminRouter.post(
  '/users/:id/role',
  requireRole('super_admin'),
  validate({ params: idParams, body: z.object({ role: z.enum(ROLES), reason }).strict() }),
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) throw notFound('User not found.');
    if (target._id.equals(actor(req)._id)) throw forbidden('You can’t change your own role.', 'SELF_ACTION');
    if ((req.body.role === 'admin' || req.body.role === 'super_admin') && !target.emailVerifiedAt) throw badRequest('Only verified accounts can be admins.', 'NOT_VERIFIED');
    const from = target.role;
    target.role = req.body.role as Role;
    await target.save();
    await audit(req, 'admin.role_change', { actorId: actor(req)._id, metadata: { targetUserId: target._id.toString(), from, to: req.body.role, reason: req.body.reason } });
    res.json({ data: { role: target.role } });
  }),
);

/* ── Jobs ───────────────────────────────────────────────────────────── */

adminRouter.get(
  '/jobs',
  validate({ query: z.object({ status: z.enum(['queued', 'active', 'completed', 'dead']).default('dead'), ...page }) }),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<{ status: string; page: number; limit: number }>(req);
    const [items, total] = await Promise.all([Job.find({ status: q.status }).sort({ updatedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), Job.countDocuments({ status: q.status })]);
    const projects = await Project.find({ _id: { $in: items.map((j) => j.projectId).filter(Boolean) } }).select('title mode').lean();
    res.json({
      data: items.map((j) => {
        const p = projects.find((x) => j.projectId && x._id.equals(j.projectId));
        return { id: j._id.toString(), type: j.type, status: j.status, attempts: j.attempts, error: j.lastError ?? null, stage: j.stage, project: p ? { id: p._id.toString(), title: p.title, mode: p.mode } : null, createdAt: j.createdAt, updatedAt: j.updatedAt };
      }),
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
    });
  }),
);

/**
 * Re-runs a failed job free of charge (its credits were already refunded when it failed), e.g. after
 * fixing a provider outage.
 */
adminRouter.post(
  '/jobs/:id/retry',
  validate({ params: idParams, body: z.object({ reason }).strict() }),
  asyncHandler(async (req, res) => {
    const job = await Job.findOne({ _id: req.params.id, status: 'dead' });
    if (!job) throw notFound('Only failed jobs can be retried.');
    if (job.projectId) {
      const claimed = await Project.findOneAndUpdate({ _id: job.projectId, status: { $in: ['failed', 'draft', 'completed'] } }, { $set: { status: 'queued', lastJobId: job._id, lastError: null } });
      if (!claimed) throw new AppError(409, 'PROJECT_BUSY', 'The project is busy with another job.');
    }
    job.set({ status: 'queued', attempts: 0, runAt: new Date(), lastError: null, lockedBy: null, lockedUntil: null, payload: { ...(job.payload as object), credits: 0 } });
    await job.save();
    await audit(req, 'admin.job_retry', { actorId: actor(req)._id, workspaceId: job.workspaceId, metadata: { jobId: job._id.toString(), type: job.type, reason: req.body.reason } });
    res.json({ data: { status: 'queued' } });
  }),
);

/* ── Payments, consents, audit log, webhooks ────────────────────────── */

adminRouter.get(
  '/payments',
  validate({ query: z.object({ status: z.enum(['created', 'paid', 'failed']).optional(), ...page }) }),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<{ status?: string; page: number; limit: number }>(req);
    const filter = q.status ? { status: q.status } : { status: { $ne: 'created' } };
    const [items, total] = await Promise.all([Payment.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), Payment.countDocuments(filter)]);
    const users = await User.find({ _id: { $in: items.map((p) => p.userId).filter(Boolean) } }).select('email').lean();
    const invoices = await Invoice.find({ _id: { $in: items.map((p) => p.invoiceId).filter(Boolean) } }).select('number').lean();
    res.json({
      data: items.map((p) => ({
        id: p._id.toString(),
        kind: p.kind,
        status: p.status,
        amountPaise: p.amountPaise,
        credits: p.credits,
        planId: p.planId,
        userEmail: users.find((u) => p.userId && u._id.equals(p.userId))?.email ?? null,
        invoice: invoices.find((i) => p.invoiceId && i._id.equals(p.invoiceId))?.number ?? null,
        providerPaymentId: p.paymentId,
        failureReason: p.failureReason,
        createdAt: p.createdAt,
      })),
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
    });
  }),
);

adminRouter.get(
  '/consents',
  validate({ query: z.object({ status: z.enum(['awaiting_subject', 'active', 'revoked']).optional(), ...page }) }),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<{ status?: string; page: number; limit: number }>(req);
    const filter = q.status ? { status: q.status } : {};
    const [items, total] = await Promise.all([ConsentRecord.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit), ConsentRecord.countDocuments(filter)]);
    const voices = await CustomVoice.find({ consentRecordId: { $in: items.map((c) => c._id) } }).select('name status consentRecordId').lean();
    res.json({
      data: items.map((c) => ({ ...toPublicConsent(c), voice: voices.find((v) => v.consentRecordId.equals(c._id)) ?? null, workspaceId: c.workspaceId.toString() })),
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
    });
  }),
);

/** Takes down a cloned voice (e.g. an impersonation report): same deletion as a withdrawal. */
adminRouter.post(
  '/consents/:id/revoke',
  validate({ params: idParams, body: z.object({ reason }).strict() }),
  asyncHandler(async (req, res) => {
    const c = await ConsentRecord.findById(req.params.id);
    if (!c) throw notFound('Consent record not found.');
    await revokeConsent(c, 'admin', { actorId: actor(req)._id });
    await audit(req, 'admin.consent_revoke', { actorId: actor(req)._id, workspaceId: c.workspaceId, metadata: { consentId: c._id.toString(), reason: req.body.reason } });
    res.json({ data: { status: 'revoked' } });
  }),
);

adminRouter.get(
  '/audit',
  validate({ query: z.object({ action: z.string().trim().max(80).optional(), userId: z.string().refine((v) => Types.ObjectId.isValid(v)).optional(), ...page }) }),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<{ action?: string; userId?: string; page: number; limit: number }>(req);
    const filter: Record<string, unknown> = {};
    if (q.action) filter.action = { $regex: `^${escapeRegex(q.action)}` };
    if (q.userId) filter.$or = [{ actorId: new Types.ObjectId(q.userId) }, { 'metadata.targetUserId': q.userId }];
    const [items, total] = await Promise.all([AuditLog.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), AuditLog.countDocuments(filter)]);
    const actors = await User.find({ _id: { $in: items.map((a) => a.actorId).filter(Boolean) } }).select('email').lean();
    res.json({
      data: items.map((a) => ({ id: a._id.toString(), action: a.action, actor: actors.find((u) => a.actorId && u._id.equals(a.actorId))?.email ?? null, ip: a.ip, metadata: a.metadata, createdAt: a.createdAt })),
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
    });
  }),
);

adminRouter.get(
  '/webhooks',
  asyncHandler(async (_req, res) => {
    const items = await WebhookEvent.find({ error: { $ne: null } }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ data: items.map((w) => ({ eventId: w.eventId, event: w.event, error: w.error, processedAt: w.processedAt, createdAt: w.createdAt })) });
  }),
);

/** Storage use per workspace, largest first (to spot abuse or plan-limit issues). */
adminRouter.get(
  '/storage',
  asyncHandler(async (_req, res) => {
    const top = await Workspace.find({ storageBytesUsed: { $gt: 0 } }).sort({ storageBytesUsed: -1 }).limit(20).select('name plan storageBytesUsed ownerId').lean();
    const counts = await Asset.aggregate([{ $match: { deletedAt: null, status: 'ready' } }, { $group: { _id: '$kind', n: { $sum: 1 }, bytes: { $sum: '$countedBytes' } } }]);
    res.json({ data: { top: top.map((w) => ({ id: w._id.toString(), name: w.name, plan: w.plan, bytes: w.storageBytesUsed })), byKind: counts } });
  }),
);
