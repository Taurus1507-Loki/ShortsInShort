import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { sendSuccess } from '../utils/response.js';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  sendSuccess(res, {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'ShortsInShort API Service',
    database: dbStatus,
    version: '1.0.0',
  });
});

export default router;

