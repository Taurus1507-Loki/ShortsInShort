import { Router } from 'express';
import type { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../../middleware/auth.js';
import { validate, validatedQuery } from '../../middleware/validate.js';
import { asyncHandler, conflict, notFound } from '../../utils/errors.js';
import { Project, toPublicProject } from '../../models/Project.js';
import { audit } from '../../services/audit.service.js';
import { createProjectSchema, idParams, listProjectsQuery, updateProjectSchema } from './projects.schemas.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every query below is scoped by the caller's workspaceId: that is the tenant-isolation boundary.

projectsRouter.get(
  '/',
  validate({ query: listProjectsQuery }),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<z.infer<typeof listProjectsQuery>>(req);
    const filter: Record<string, unknown> = { workspaceId: req.auth!.workspaceId, deletedAt: null };
    if (q.status) filter.status = q.status;
    if (q.mode) filter.mode = q.mode;
    if (q.q) filter.title = { $regex: escapeRegex(q.q), $options: 'i' };

    const [items, total] = await Promise.all([
      Project.find(filter).sort({ updatedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
      Project.countDocuments(filter),
    ]);
    res.json({
      data: items.map(toPublicProject),
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
    });
  }),
);

projectsRouter.post(
  '/',
  requireVerifiedEmail,
  validate({ body: createProjectSchema }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const project = await Project.create({ ...req.body, workspaceId, createdBy: user._id });
    await audit(req, 'project.created', { actorId: user._id, workspaceId, metadata: { projectId: project._id.toString() } });
    res.status(201).json({ data: toPublicProject(project) });
  }),
);

projectsRouter.get(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const project = await Project.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId, deletedAt: null });
    if (!project) throw notFound('Project not found.');
    res.json({ data: toPublicProject(project) });
  }),
);

projectsRouter.patch(
  '/:id',
  validate({ params: idParams, body: updateProjectSchema }),
  asyncHandler(async (req, res) => {
    const project = await Project.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId, deletedAt: null });
    if (!project) throw notFound('Project not found.');
    if (project.status === 'queued' || project.status === 'processing') {
      throw conflict('This project is being processed and cannot be edited right now.', 'PROJECT_BUSY');
    }
    const { settings, ...rest } = req.body as z.infer<typeof updateProjectSchema>;
    project.set(rest);
    if (settings) project.set('settings', { ...project.toObject().settings, ...settings });
    await project.save();
    res.json({ data: toPublicProject(project) });
  }),
);

projectsRouter.delete(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const r = await Project.updateOne(
      { _id: req.params.id, workspaceId, deletedAt: null, status: { $nin: ['queued', 'processing'] } },
      { deletedAt: new Date() },
    );
    if (r.matchedCount === 0) throw notFound('Project not found or currently processing.');
    await audit(req, 'project.deleted', { actorId: user._id, workspaceId, metadata: { projectId: req.params.id } });
    res.status(204).end();
  }),
);
