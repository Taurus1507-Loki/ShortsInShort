import { Request, Response } from 'express';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { Subscription } from '../models/Subscription.js';
import { CreditTransaction } from '../models/CreditTransaction.js';
import { CreditService } from '../services/creditService.js';
import { sendSuccess, sendError } from '../utils/response.js';

export const getAdminMetrics = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [totalUsers, totalProjects, activeSubscriptions, creditStats] = await Promise.all([
      User.countDocuments(),
      Project.countDocuments(),
      Subscription.countDocuments({ status: 'active' }),
      CreditTransaction.aggregate([
        { $match: { amount: { $lt: 0 } } },
        { $group: { _id: null, totalCreditsUsed: { $sum: { $abs: '$amount' } } } },
      ]),
    ]);

    const completedProjects = await Project.countDocuments({ status: 'ready' });
    const failedProjects = await Project.countDocuments({ status: 'failed' });

    sendSuccess(res, {
      totalUsers,
      totalProjects,
      completedProjects,
      failedProjects,
      activeSubscriptions,
      totalCreditsConsumed: creditStats[0]?.totalCreditsUsed || 0,
      estimatedRevenueINR: activeSubscriptions * 999, // Average blended MRR
    });
  } catch (err: any) {
    sendError(res, err.message || 'Failed to fetch admin metrics', 500);
  }
};

export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';

    const filter: any = {};
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-passwordHash')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    sendSuccess(res, {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    sendError(res, err.message || 'Failed to fetch users', 500);
  }
};

export const adjustUserCredits = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, amount, description } = req.body;
    if (!userId || typeof amount !== 'number') {
      sendError(res, 'userId and a numeric credit amount are required', 400);
      return;
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      sendError(res, 'Target user not found', 404);
      return;
    }

    if (amount > 0) {
      await CreditService.refundCredits({
        userId,
        workspaceId: targetUser.workspaceId.toString(),
        amount,
        description: description || `Admin adjustment granted by ${req.user!.email}`,
      });
    } else {
      await CreditService.deductCredits({
        userId,
        workspaceId: targetUser.workspaceId.toString(),
        amount: Math.abs(amount),
        operation: 'admin_adjustment',
        description: description || `Admin deduction applied by ${req.user!.email}`,
      });
    }

    const updated = await User.findById(userId).select('-passwordHash');
    sendSuccess(res, updated, 'User credits updated successfully');
  } catch (err: any) {
    sendError(res, err.message || 'Credit adjustment failed', 500);
  }
};

export const updateUserPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, planTier, role } = req.body;
    if (!userId) {
      sendError(res, 'userId is required', 400);
      return;
    }

    const updateFields: any = {};
    if (planTier) updateFields.planTier = planTier;
    if (role) updateFields.role = role;

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true }
    ).select('-passwordHash');

    if (!user) {
      sendError(res, 'User not found', 404);
      return;
    }

    sendSuccess(res, user, 'User updated successfully');
  } catch (err: any) {
    sendError(res, err.message || 'Failed to update user', 500);
  }
};

