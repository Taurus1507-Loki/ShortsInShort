import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import {
  uploadAvatarImage,
  uploadVoiceSample,
  createAvatarConsent,
  getAvatars,
  getAvatar,
  updateAvatarConsent,
  createAvatarWithProvider,
  generateAvatarVideo,
  getAvatarProviderStatus,
} from '../controllers/avatarController.js';
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
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/mp4'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image (JPEG, PNG, WebP) and audio (MP3, WAV, MP4) files are supported'));
    }
  },
});

const router = Router();

router.use(requireAuth);

// Provider status
router.get('/providers/status', getAvatarProviderStatus);

// Avatar management
router.get('/', getAvatars);
router.get('/:id', getAvatar);
router.post('/consent', createAvatarConsent);
router.patch('/:id/consent', updateAvatarConsent);
router.post('/:id/create', createAvatarWithProvider);

// File uploads
router.post('/upload/image', upload.single('image'), uploadAvatarImage);
router.post('/upload/voice', upload.single('voice'), uploadVoiceSample);

// Avatar video generation
router.post('/projects/:projectId/avatar/:avatarId/generate', generateAvatarVideo);

export default router;