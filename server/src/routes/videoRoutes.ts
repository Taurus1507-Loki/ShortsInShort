import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import {
  uploadRawVideo,
  analyzeVideo,
  renderVideo,
  updateSubtitles,
  getVideoStatus,
} from '../controllers/videoController.js';
import { requireAuth } from '../middleware/auth.js';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.resolve(process.cwd(), 'uploads', 'raw'));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `raw-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250MB limit
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video and audio files are supported'));
    }
  },
});

const router = Router();

router.use(requireAuth);

router.post('/upload', upload.single('video'), uploadRawVideo);
router.post('/:id/analyze', analyzeVideo);
router.post('/:id/render', renderVideo);
router.put('/:id/subtitles', updateSubtitles);
router.get('/:id/status', getVideoStatus);

export default router;

