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
      sendError(res, 'No media file provided', 400);
      return;
    }

    const relativeUrl = `/uploads/raw/${req.file.filename}`;
    const fullPath = req.file.path;
    const isImage = req.file.mimetype.startsWith('image/');
    const isVideo = req.file.mimetype.startsWith('video/');

    // Get metadata from uploaded video or image
    let meta: any = { duration: 10, width: 1080, height: 1920, fps: 30 };
    try {
      meta = await FFmpegService.getVideoMetadata(fullPath);
      if (isImage && (!meta.duration || meta.duration === 0)) {
        meta.duration = 10; // Default 10s duration for static image background/scenes
      }
    } catch {
      // Use fallback defaults for metadata
    }

    sendSuccess(res, {
      url: relativeUrl,
      fileName: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      isImage,
      isVideo,
      metadata: meta,
    }, isImage ? 'Image uploaded successfully' : 'Video uploaded successfully');
  } catch (err: any) {
    sendError(res, err.message || 'Media upload failed', 500);
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
    sendSuccess(res, project, 'Video rendering completed');
  } catch (err: any) {
    sendError(res, err.message || 'Rendering failed', 500);
  }
};

export const getRenderJobStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const jobId = req.params.jobId as string;
    const status = await VideoPipelineService.getRenderJobStatus(jobId);
    
    if (!status) {
      sendError(res, 'Job not found', 404);
      return;
    }
    
    sendSuccess(res, status);
  } catch (err: any) {
    sendError(res, err.message || 'Failed to fetch job status', 500);
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
    }).select('status progress outputVideoUrl thumbnailUrl renderError renderJobId');

    if (!project) {
      sendError(res, 'Project not found', 404);
      return;
    }

    // If there's a render job ID, also fetch queue status
    let jobStatus = null;
    if (project.renderJobId) {
      jobStatus = await VideoPipelineService.getRenderJobStatus(project.renderJobId);
    }

    sendSuccess(res, { project, jobStatus });
  } catch (err: any) {
    sendError(res, err.message || 'Failed to fetch status', 500);
  }
};

export const getPresignedUpload = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fileName, contentType, type = 'raw' } = req.body;
    if (!fileName || !contentType) {
      sendError(res, 'fileName and contentType are required', 400);
      return;
    }

    const { getStorageService, generateStorageKey } = await import('../services/storage/storageService.js');
    const storageService = getStorageService();
    const ext = path.extname(fileName).replace('.', '') || 'mp4';
    const key = generateStorageKey(req.user!.userId, type, ext);

    const presigned = await storageService.getPresignedUploadUrl(key, contentType, 3600);
    sendSuccess(res, presigned, 'Presigned upload URL generated');
  } catch (err: any) {
    sendError(res, err.message || 'Failed to generate upload URL', 500);
  }
};