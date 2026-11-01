import { Router } from 'express';
import { listTemplates, getTemplateById } from '../controllers/templateController.js';

const router = Router();

// Templates can be viewed publicly or authenticated
router.get('/', listTemplates);
router.get('/:id', getTemplateById);

export default router;

