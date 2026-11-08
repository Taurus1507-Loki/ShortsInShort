import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { avatarService } from '../services/avatarService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { requireAuth } from '../middleware/auth.js';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.resolve(process.cwd(), 'uploads', 'temp'));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.tmp';
    cb(null, `upload-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/mp4'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image (JPEG, PNG, WebP) and audio (MP3, WAV, MP4) files are supported'));
    }
  },
});

const getParamId = (req: Request): string => {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
};

export const uploadAvatarImage = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      sendError(res, 'No image file provided', 400);
      return;
    }

    const imageUrl = await avatarService.uploadProfileImage(req.user!.userId, req.file);
    
    sendSuccess(res, { url: imageUrl }, 'Profile image uploaded successfully');
  } catch (err: any) {
    sendError(res, err.message || 'Image upload failed', 500);
  }
};

export const uploadVoiceSample = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      sendError(res, 'No audio file provided', 400);
      return;
    }

    const voiceUrl = await avatarService.uploadVoiceSample(req.user!.userId, req.file);
    
    sendSuccess(res, { url: voiceUrl }, 'Voice sample uploaded successfully');
  } catch (err: any) {
    sendError(res, err.message || 'Voice upload failed', 500);
  }
};

export const createAvatarConsent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { avatarName, provider, profileImageUrl, voiceSampleUrl, explicitConsentGiven, legalDeclarationSigned } = req.body;

    if (!avatarName || !provider || !profileImageUrl) {
      sendError(res, 'avatarName, provider, and profileImageUrl are required', 400);
      return;
    }

    if (!explicitConsentGiven || !legalDeclarationSigned) {
      sendError(res, 'Explicit consent and legal declaration are required', 400);
      return;
    }

    const consent = await avatarService.createConsentRecord(req.user!.userId, {
      avatarName,
      provider,
      profileImageUrl,
      voiceSampleUrl,
      explicitConsentGiven: true,
      legalDeclarationSigned: true,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    sendSuccess(res, consent, 'Avatar consent created successfully');
  } catch (err: any) {
    sendError(res, err.message || 'Failed to create avatar consent', 500);
  }
};

export const getAvatars = async (req: Request, res: Response): Promise<void> => {
  try {
    const avatars = await avatarService.getUserAvatars(req.user!.userId);
    sendSuccess(res, avatars);
  } catch (err: any) {
    sendError(res, err.message || 'Failed to fetch avatars', 500);
  }
};

export const getAvatar = async (req: Request, res: Response): Promise<void> => {
  try {
    const avatar = await avatarService.getAvatar(req.user!.userId, getParamId(req));
    if (!avatar) {
      sendError(res, 'Avatar not found', 404);
      return;
    }
    sendSuccess(res, avatar);
  } catch (err: any) {
    sendError(res, err.message || 'Failed to fetch avatar', 500);
  }
};

export const updateAvatarConsent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, notes } = req.body;
    const avatar = await avatarService.updateAvatarConsent(req.user!.userId, getParamId(req), { status, notes });
    
    if (!avatar) {
      sendError(res, 'Avatar not found', 404);
      return;
    }
    
    sendSuccess(res, avatar, 'Avatar consent updated');
  } catch (err: any) {
    sendError(res, err.message || 'Failed to update avatar', 500);
  }
};

export const createAvatarWithProvider = async (req: Request, res: Response): Promise<void> => {
  try {
    const avatar = await avatarService.createAvatarWithProvider(getParamId(req));
    sendSuccess(res, avatar, 'Avatar creation initiated with provider');
  } catch (err: any) {
    sendError(res, err.message || 'Failed to create avatar with provider', 500);
  }
};

export const generateAvatarVideo = async (req: Request, res: Response): Promise<void> => {
  try {
    const { script, language, voiceId, aspectRatio, resolution, backgroundUrl } = req.body;

    if (!script || !voiceId) {
      sendError(res, 'script and voiceId are required', 400);
      return;
    }

    const projectIdParam = req.params.projectId;
    const avatarIdParam = req.params.avatarId;
    const projectId = Array.isArray(projectIdParam) ? projectIdParam[0] : projectIdParam;
    const avatarId = Array.isArray(avatarIdParam) ? avatarIdParam[0] : avatarIdParam;

    const project = await avatarService.generateAvatarVideo(
      projectId,
      req.user!.userId,
      req.user!.workspaceId,
      {
        avatarId,
        script,
        language: language || 'en',
        voiceId,
        aspectRatio: aspectRatio || '9:16',
        resolution: resolution || '1080p',
        backgroundUrl,
      }
    );

    sendSuccess(res, project, 'Avatar video generation completed');
  } catch (err: any) {
    sendError(res, err.message || 'Failed to generate avatar video', 500);
  }
};

export const getAvatarProviderStatus = async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = avatarService.getProviderStatus();
    sendSuccess(res, status);
  } catch (err: any) {
    sendError(res, err.message || 'Failed to get provider status', 500);
  }
};