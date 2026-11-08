import { Request, Response } from 'express';
import { facelessVideoService } from '../services/facelessVideoService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { requireAuth } from '../middleware/auth.js';

const getParamId = (req: Request, param: string): string => {
  const val = req.params[param];
  return Array.isArray(val) ? val[0] : val;
};

export const getFacelessTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const { category } = req.query;
    let templates = facelessVideoService.getTemplates();
    
    if (category) {
      templates = templates.filter(t => t.category === category);
    }
    
    sendSuccess(res, templates);
  } catch (err: any) {
    sendError(res, err.message || 'Failed to fetch templates', 500);
  }
};

export const getFacelessTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const template = facelessVideoService.getTemplate(getParamId(req, 'id'));
    if (!template) {
      sendError(res, 'Template not found', 404);
      return;
    }
    sendSuccess(res, template);
  } catch (err: any) {
    sendError(res, err.message || 'Failed to fetch template', 500);
  }
};

export const analyzeFacelessScript = async (req: Request, res: Response): Promise<void> => {
  try {
    const { script, templateId } = req.body;
    
    if (!script) {
      sendError(res, 'script is required', 400);
      return;
    }

    const analysis = await facelessVideoService.analyzeScriptForFaceless(script, templateId);
    sendSuccess(res, analysis, 'Script analyzed successfully');
  } catch (err: any) {
    sendError(res, err.message || 'Failed to analyze script', 500);
  }
};

export const generateFacelessVideo = async (req: Request, res: Response): Promise<void> => {
  try {
    const { script, templateId, voiceId, language, aspectRatio, resolution, backgroundMusic, musicVolume, autoDucking } = req.body;

    if (!script || !voiceId) {
      sendError(res, 'script and voiceId are required', 400);
      return;
    }

    const projectId = getParamId(req, 'projectId');
    if (!projectId) {
      sendError(res, 'projectId is required', 400);
      return;
    }

    const project = await facelessVideoService.generateFacelessVideo(
      projectId,
      req.user!.userId,
      req.user!.workspaceId,
      {
        script,
        templateId,
        voiceId,
        language: language || 'en',
        aspectRatio: aspectRatio || '9:16',
        resolution: resolution || '1080p',
        backgroundMusic,
        musicVolume,
        autoDucking,
      }
    );

    sendSuccess(res, project, 'Faceless video generation completed');
  } catch (err: any) {
    sendError(res, err.message || 'Failed to generate faceless video', 500);
  }
};

export const getTTSVoices = async (req: Request, res: Response): Promise<void> => {
  try {
    const { getAIService } = await import('../services/ai/aiService.js');
    const aiService = getAIService();
    const voices = await aiService.getVoices();
    sendSuccess(res, voices);
  } catch (err: any) {
    sendError(res, err.message || 'Failed to fetch TTS voices', 500);
  }
};