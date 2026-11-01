import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { Project } from '../models/Project.js';
import { VideoPipelineService } from '../services/video/videoPipelineService.js';
import { FFmpegService } from '../services/video/ffmpegService.js';
import { sendSuccess, sendError } from '../utils/response.js';

export const uploadRawVideo = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      sendError(res, 'No video file provided', 400);
      return;
    }

    const relativeUrl = `/uploads/raw/${req.file.filename}`;
    const fullPath = req.file.path;

    // Get metadata from uploaded video
    const meta = await FFmpegService.getVideoMetadata(fullPath);

    sendSuccess(res, {
      url: relativeUrl,
      fileName: req.file.filename,
      size: req.file.size,
      metadata: meta,
    }, 'Video uploaded successfully');
  } catch (err: any) {
    sendError(res, err.message || 'Video upload failed', 500);
  }
};

export const analyzeVideo = async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const project = await VideoPipelineService.analyzeVideo(projectId, req.user!.userId);
    sendSuccess(res, project, 'Video analysis & transcription complete');
  } catch (err: any) {
    sendError(res, err.message || 'Analysis failed', 500);
  }
};

export const renderVideo = async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const project = await VideoPipelineService.renderProject(
      projectId,
      req.user!.userId,
      req.user!.workspaceId
    );
    sendSuccess(res, project, 'Video rendering initiated');
  } catch (err: any) {
    sendError(res, err.message || 'Rendering failed', 500);
  }
};

export const updateSubtitles = async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const { transcription, scenes } = req.body;

    const project = await Project.findOneAndUpdate(
      { _id: projectId, userId: req.user!.userId },
      { $set: { transcription, ...(scenes ? { scenes } : {}) } },
      { new: true }
    );

    if (!project) {
      sendError(res, 'Project not found', 404);
      return;
    }

    sendSuccess(res, project, 'Subtitles updated successfully');
  } catch (err: any) {
    sendError(res, err.message || 'Failed to update subtitles', 500);
  }
};

export const getVideoStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const project = await Project.findOne({
      _id: projectId,
      userId: req.user!.userId,
    }).select('status progress outputVideoUrl thumbnailUrl renderError');

    if (!project) {
      sendError(res, 'Project not found', 404);
      return;
    }

    sendSuccess(res, project);
  } catch (err: any) {
    sendError(res, err.message || 'Failed to fetch status', 500);
  }
};

