import { Router } from 'express';
import {
  getFacelessTemplates,
  getFacelessTemplate,
  analyzeFacelessScript,
  generateFacelessVideo,
  getTTSVoices,
} from '../controllers/facelessController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// TTS Voices
router.get('/tts/voices', getTTSVoices);

// Templates
router.get('/templates', getFacelessTemplates);
router.get('/templates/:id', getFacelessTemplate);

// Script analysis
router.post('/analyze', analyzeFacelessScript);

// Video generation
router.post('/projects/:projectId/generate', generateFacelessVideo);

export default router;