import { Router } from 'express';
import {
  listProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  createProjectSchema,
} from '../controllers/projectController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import { enforceTenantScope } from '../middleware/tenantIsolation.js';

const router = Router();

router.use(requireAuth);
router.use(enforceTenantScope);

router.get('/', listProjects);
router.post('/', validateRequest(createProjectSchema), createProject);
router.get('/:id', getProject);
router.patch('/:id', updateProject);
router.delete('/:id', deleteProject);

export default router;

