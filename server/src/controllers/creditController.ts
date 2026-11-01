import { Request, Response } from 'express';
import { CreditService } from '../services/creditService.js';
import { sendSuccess, sendError } from '../utils/response.js';

export const getBalance = async (req: Request, res: Response): Promise<void> => {
  try {
    const balance = await CreditService.getBalance(req.user!.userId);
    sendSuccess(res, { balance });
  } catch (err: any) {
    sendError(res, err.message, 500);
  }
};

export const getHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = parseInt(req.query.skip as string) || 0;
    const history = await CreditService.getHistory(req.user!.userId, limit, skip);
    sendSuccess(res, history);
  } catch (err: any) {
    sendError(res, err.message, 500);
  }
};

export const estimateCost = async (req: Request, res: Response): Promise<void> => {
  try {
    const { mode, durationSec = 60, resolution = '1080p' } = req.body;

    let baseCost = 1;
    if (mode === 'ai_avatar') baseCost = 3;
    if (mode === 'faceless') baseCost = 2;
    if (resolution === '4k') baseCost += 1;
    if (durationSec > 90) baseCost += Math.ceil((durationSec - 90) / 60);

    sendSuccess(res, { estimatedCredits: baseCost });
  } catch (err: any) {
    sendError(res, err.message, 400);
  }
};

