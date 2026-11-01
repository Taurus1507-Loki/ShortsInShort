import { Request, Response } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { ProjectService } from '../services/projectService.js';
import { CreditService } from '../services/creditService.js';
import { PLAN_CONFIGS } from '../models/Subscription.js';
import { sendSuccess, sendError } from '../utils/response.js';

export const brandKitSchema = z.object({
  logoUrl: z.string().optional(),
  primaryColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Invalid hex color code'),
  secondaryColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Invalid hex color code'),
  fontFamily: z.string().min(1),
  captionStyle: z.string().min(1),
  watermarkUrl: z.string().optional(),
  watermarkPosition: z.enum(['top_left', 'top_right', 'bottom_left', 'bottom_right']),
});

export const getProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user!.userId).select('-passwordHash');
    if (!user) {
      sendError(res, 'User not found', 404);
      return;
    }
    sendSuccess(res, user);
  } catch (err: any) {
    sendError(res, err.message, 500);
  }
};

export const updateBrandKit = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user!.userId,
      { $set: { brandKit: req.body } },
      { new: true }
    ).select('-passwordHash');

    if (!user) {
      sendError(res, 'User not found', 404);
      return;
    }

    sendSuccess(res, user.brandKit, 'Brand kit updated successfully');
  } catch (err: any) {
    sendError(res, err.message, 500);
  }
};

export const getDashboardSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const user = await User.findById(userId).select('-passwordHash');
    if (!user) {
      sendError(res, 'User not found', 404);
      return;
    }

    const projectStats = await ProjectService.getProjectStats(userId);
    const planConfig = PLAN_CONFIGS[user.planTier];

    const summary = {
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        planTier: user.planTier,
        creditBalance: user.creditBalance,
        subscriptionStatus: user.subscriptionStatus,
      },
      plan: planConfig,
      stats: {
        totalVideos: projectStats.totalVideos,
        completedVideos: projectStats.completedVideos,
        processingVideos: projectStats.processingVideos,
        failedVideos: projectStats.failedVideos,
        creditsAvailable: user.creditBalance,
        storageUsedMb: Math.round(projectStats.totalVideos * 42.5), // Approximate storage footprint per short
      },
    };

    sendSuccess(res, summary);
  } catch (err: any) {
    sendError(res, err.message, 500);
  }
};

