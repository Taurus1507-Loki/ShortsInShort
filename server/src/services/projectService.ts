import mongoose from 'mongoose';
import { Project, IProject, CreationMode, AspectRatio, Resolution } from '../models/Project.js';
import { CreditService } from './creditService.js';

export interface CreateProjectDTO {
  title: string;
  creationMode: CreationMode;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
  script?: string;
  rawVideoUrl?: string;
  editingPreferences?: Partial<IProject['editingPreferences']>;
}

export class ProjectService {
  static async listUserProjects(userId: string, filter?: { status?: string; mode?: string }) {
    const query: any = { userId: new mongoose.Types.ObjectId(userId) };
    if (filter?.status && filter.status !== 'all') {
      query.status = filter.status;
    }
    if (filter?.mode && filter.mode !== 'all') {
      query.creationMode = filter.mode;
    }

    return Project.find(query).sort({ createdAt: -1 }).lean();
  }

  static async getProjectById(userId: string, projectId: string) {
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return null;
    }
    return Project.findOne({
      _id: new mongoose.Types.ObjectId(projectId),
      userId: new mongoose.Types.ObjectId(userId),
    });
  }

  static async createProject(
    userId: string,
    workspaceId: string,
    data: CreateProjectDTO
  ): Promise<IProject> {
    // Determine credit cost based on creation mode
    let creditsCost = 1;
    if (data.creationMode === 'ai_avatar') creditsCost = 3;
    if (data.creationMode === 'faceless') creditsCost = 2;

    const project = await Project.create({
      userId: new mongoose.Types.ObjectId(userId),
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
      title: data.title,
      creationMode: data.creationMode,
      aspectRatio: data.aspectRatio || '9:16',
      resolution: data.resolution || '1080p',
      script: data.script,
      rawVideoUrl: data.rawVideoUrl,
      status: 'draft',
      progress: 0,
      creditsCost,
      editingPreferences: {
        editingStyle: 'Viral',
        captionStyle: 'karaoke_neon',
        captionPosition: 'middle',
        highlightKeywords: true,
        removePauses: true,
        silenceThresholdDb: -30,
        minSilenceDurationMs: 450,
        brollIntensity: 'medium',
        zoomIntensity: 'dynamic',
        backgroundMusic: 'energetic_trap',
        musicVolume: 15,
        autoDucking: true,
        ...data.editingPreferences,
      },
    });

    return project;
  }

  static async updateProject(
    userId: string,
    projectId: string,
    updates: Partial<IProject>
  ): Promise<IProject | null> {
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return null;
    }

    return Project.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(projectId),
        userId: new mongoose.Types.ObjectId(userId),
      },
      { $set: updates },
      { new: true }
    );
  }

  static async deleteProject(userId: string, projectId: string): Promise<boolean> {
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return false;
    }

    const res = await Project.deleteOne({
      _id: new mongoose.Types.ObjectId(projectId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    return res.deletedCount === 1;
  }

  static async getProjectStats(userId: string) {
    const totalProjects = await Project.countDocuments({ userId });
    const readyProjects = await Project.countDocuments({ userId, status: 'ready' });
    const processingProjects = await Project.countDocuments({
      userId,
      status: { $in: ['queued', 'transcribing', 'analyzing', 'rendering'] },
    });
    const failedProjects = await Project.countDocuments({ userId, status: 'failed' });

    return {
      totalVideos: totalProjects,
      completedVideos: readyProjects,
      processingVideos: processingProjects,
      failedVideos: failedProjects,
    };
  }
}

