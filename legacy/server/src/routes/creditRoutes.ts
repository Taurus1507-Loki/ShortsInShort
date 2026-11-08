import { Router } from 'express';
import { getBalance, getHistory, estimateCost } from '../controllers/creditController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/balance', getBalance);
router.get('/history', getHistory);
router.post('/estimate', estimateCost);

export default router;

