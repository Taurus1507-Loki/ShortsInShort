import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getAdminMetrics,
  getAllUsers,
  adjustUserCredits,
  updateUserPlan,
} from '../controllers/adminController.js';
import { sendError } from '../utils/response.js';

const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'super_admin')) {
    sendError(res, 'Access denied. Administrator privileges required.', 403);
    return;
  }
  next();
};

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

router.get('/metrics', getAdminMetrics);
router.get('/users', getAllUsers);
router.post('/users/adjust-credits', adjustUserCredits);
router.patch('/users/update-plan', updateUserPlan);

export default router;

