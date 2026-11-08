import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler, notFound } from '../../utils/errors.js';
import { Project, PROJECT_STATUSES, toPublicProject } from '../../models/Project.js';
import { Workspace } from '../../models/Workspace.js';
import { CreditTransaction } from '../../models/CreditTransaction.js';
import { PLANS, type PlanId } from '../../config/plans.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

/** All figures come from the database — nothing here is illustrative. */
dashboardRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const workspaceId = req.auth!.workspaceId;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [ws, byStatus, recent, usage] = await Promise.all([
      Workspace.findById(workspaceId).lean(),
      Project.aggregate<{ _id: string; count: number }>([
        { $match: { workspaceId, deletedAt: null } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Project.find({ workspaceId, deletedAt: null }).sort({ updatedAt: -1 }).limit(5),
      CreditTransaction.aggregate<{ _id: null; used: number }>([
        { $match: { workspaceId, status: 'applied', amount: { $lt: 0 }, createdAt: { $gte: monthStart } } },
        { $group: { _id: null, used: { $sum: { $abs: '$amount' } } } },
      ]),
    ]);
    if (!ws) throw notFound('Workspace not found.');

    const plan = PLANS[ws.plan as PlanId];
    const counts = Object.fromEntries(PROJECT_STATUSES.map((s) => [s, 0])) as Record<(typeof PROJECT_STATUSES)[number], number>;
    for (const row of byStatus) counts[row._id as keyof typeof counts] = row.count;

    res.json({
      data: {
        plan: { id: plan.id, name: plan.name, monthlyCredits: plan.monthlyCredits, maxResolution: plan.maxResolution },
        credits: { balance: ws.creditBalance, usedThisMonth: usage[0]?.used ?? 0 },
        projects: {
          total: Object.values(counts).reduce((a, b) => a + b, 0),
          byStatus: counts,
        },
        storage: { usedBytes: ws.storageBytesUsed, limitBytes: plan.storageBytes },
        recentProjects: recent.map(toPublicProject),
      },
    });
  }),
);
