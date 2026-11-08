import { Request, Response } from 'express';
import { Template } from '../models/Template.js';
import { sendSuccess, sendError } from '../utils/response.js';

export const listTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const { category, aspectRatio } = req.query;
    const filter: any = {};
    if (category && category !== 'All') {
      filter.category = category;
    }
    if (aspectRatio) {
      filter.aspectRatio = aspectRatio;
    }

    const templates = await Template.find(filter).sort({ isPremium: 1, createdAt: -1 });
    sendSuccess(res, templates);
  } catch (err: any) {
    sendError(res, err.message, 500);
  }
};

export const getTemplateById = async (req: Request, res: Response): Promise<void> => {
  try {
    const templateId = req.params.id as string;
    const template = await Template.findById(templateId);
    if (!template) {
      sendError(res, 'Template not found', 404);
      return;
    }
    sendSuccess(res, template);
  } catch (err: any) {
    sendError(res, err.message, 500);
  }
};
