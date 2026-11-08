import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import {
  uploadRawVideo,
  analyzeVideo,
  renderVideo,
  getRenderJobStatus,
  updateSubtitles,
  getVideoStatus,
  getPresignedUpload,
} from '../controllers/videoController.js';
import { requireAuth } from '../middleware/auth.js';

import fs from 'fs';

const uploadDir = path.resolve(process.cwd(), 'uploads', 'raw');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.mimetype.startsWith('image/') ? '.jpg' : '.mp4');
    cb(null, `raw-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250MB limit
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('audio/')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only video, image, and audio files are supported'));
    }
  },
});

const router = Router();

router.use(requireAuth);

router.post('/upload', upload.single('video'), uploadRawVideo);
router.post('/presigned-upload', getPresignedUpload);
router.post('/:id/analyze', analyzeVideo);
router.post('/:id/render', renderVideo);
router.get('/render/:jobId/status', getRenderJobStatus);
router.put('/:id/subtitles', updateSubtitles);
router.get('/:id/status', getVideoStatus);

export default router;

