import { Router } from 'express';
import {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  registerSchema,
  loginSchema,
} from '../controllers/authController.js';
import { validateRequest } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', validateRequest(registerSchema), register);
router.post('/login', validateRequest(loginSchema), login);
router.post('/refresh', refreshToken);
router.post('/logout', logout);
router.get('/me', requireAuth, getMe);

export default router;

