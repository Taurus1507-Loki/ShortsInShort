import { Router } from 'express';
import {
  getProfile,
  updateBrandKit,
  getDashboardSummary,
  brandKitSchema,
} from '../controllers/userController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';

const router = Router();

router.use(requireAuth);

router.get('/profile', getProfile);
router.get('/dashboard-summary', getDashboardSummary);
router.put('/brand-kit', validateRequest(brandKitSchema), updateBrandKit);

export default router;

