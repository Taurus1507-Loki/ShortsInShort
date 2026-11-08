import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/authService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { User } from '../models/User.js';

export const registerSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  email: z.string().email('Please provide a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const loginSchema = z.object({
  email: z.string().email('Please provide a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await AuthService.register(req.body);

    // Set refresh token in HTTP-only cookie
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    sendSuccess(res, result, 'Registration successful. Welcome to ShortsInShort!', 201);
  } catch (err: any) {
    sendError(res, err.message || 'Registration failed', 400);
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await AuthService.login(req.body);

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    sendSuccess(res, result, 'Login successful. Welcome back!');
  } catch (err: any) {
    sendError(res, err.message || 'Authentication failed', 401);
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.cookies.refreshToken || req.body.refreshToken;
    if (!token) {
      sendError(res, 'Refresh token required', 401);
      return;
    }

    const result = await AuthService.refresh(token);
    sendSuccess(res, result, 'Token refreshed successfully');
  } catch (err: any) {
    sendError(res, 'Session expired. Please log in again.', 401);
  }
};

export const logout = async (_req: Request, res: Response): Promise<void> => {
  res.clearCookie('refreshToken');
  res.clearCookie('accessToken');
  sendSuccess(res, null, 'Successfully logged out.');
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      sendError(res, 'Unauthorized', 401);
      return;
    }

    const user = await User.findById(req.user.userId).select('-passwordHash');
    if (!user) {
      sendError(res, 'User not found', 404);
      return;
    }

    sendSuccess(res, user);
  } catch (err: any) {
    sendError(res, err.message || 'Failed to fetch user', 500);
  }
};

