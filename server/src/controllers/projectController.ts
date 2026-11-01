import { Request, Response } from 'express';
import { z } from 'zod';
import { ProjectService } from '../services/projectService.js';
import { sendSuccess, sendError } from '../utils/response.js';

export const createProjectSchema = z.object({
  title: z.string().min(1, 'Project title is required').max(100),
  creationMode: z.enum(['ai_editor', 'ai_avatar', 'faceless']),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:5']).optional(),
  resolution: z.enum(['720p', '1080p', '4k']).optional(),
  script: z.string().optional(),
  rawVideoUrl: z.string().url().optional().or(z.literal('')),
  editingPreferences: z
    .object({
      editingStyle: z
        .enum(['Podcast', 'Cinematic', 'Viral', 'Educational', 'Business', 'Storytelling', 'Vlog'])
        .optional(),
      captionStyle: z.string().optional(),
      captionPosition: z.enum(['top', 'middle', 'bottom']).optional(),
      highlightKeywords: z.boolean().optional(),
      removePauses: z.boolean().optional(),
      brollIntensity: z.enum(['none', 'low', 'medium', 'high']).optional(),
      zoomIntensity: z.enum(['none', 'subtle', 'dynamic']).optional(),
      backgroundMusic: z.string().optional(),
    })
    .optional(),
});

export const listProjects = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, mode } = req.query;
    const projects = await ProjectService.listUserProjects(req.user!.userId, {
      status: status as string,
      mode: mode as string,
    });
    sendSuccess(res, projects);
  } catch (err: any) {
    sendError(res, err.message, 500);
  }
};

export const getProject = async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const project = await ProjectService.getProjectById(req.user!.userId, projectId);
    if (!project) {
      sendError(res, 'Project not found', 404);
      return;
    }
    sendSuccess(res, project);
  } catch (err: any) {
    sendError(res, err.message, 500);
  }
};

export const createProject = async (req: Request, res: Response): Promise<void> => {
  try {
    const project = await ProjectService.createProject(
      req.user!.userId,
      req.user!.workspaceId,
      req.body
    );
    sendSuccess(res, project, 'Project created successfully', 201);
  } catch (err: any) {
    sendError(res, err.message, 400);
  }
};

export const updateProject = async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const updated = await ProjectService.updateProject(
      req.user!.userId,
      projectId,
      req.body
    );
    if (!updated) {
      sendError(res, 'Project not found or update unauthorized', 404);
      return;
    }
    sendSuccess(res, updated, 'Project updated successfully');
  } catch (err: any) {
    sendError(res, err.message, 400);
  }
};

export const deleteProject = async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const deleted = await ProjectService.deleteProject(req.user!.userId, projectId);
    if (!deleted) {
      sendError(res, 'Project not found or delete unauthorized', 404);
      return;
    }
    sendSuccess(res, { id: projectId }, 'Project deleted successfully');
  } catch (err: any) {
    sendError(res, err.message, 500);
  }
};
