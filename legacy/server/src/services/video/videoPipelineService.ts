import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { Project, IProject } from '../../models/Project.js';
import { FFmpegService, AudioMixOptions, RenderVideoOptions, ZoomEffectOptions, TransitionOptions } from './ffmpegService.js';
import { TranscriptionService } from '../ai/transcriptionService.js';
import { BrollService } from '../ai/brollService.js';
import { CreditService } from '../creditService.js';

export class VideoPipelineService {
  /**
   * Analyzes raw video or script: transcribes audio, detects silences, and matches B-roll
   */
  public static async analyzeVideo(projectId: string, userId: string): Promise<IProject> {
    const project = await Project.findOne({
      _id: new mongoose.Types.ObjectId(projectId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // 1. Resolve media path or placeholder
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    let localVideoPath = '';
    if (project.rawVideoUrl && project.rawVideoUrl.startsWith('/uploads/')) {
      localVideoPath = path.resolve(process.cwd(), project.rawVideoUrl.slice(1));
    }

    // 2. Transcribe speech
    const { transcription, scenes } = await TranscriptionService.transcribe(
      localVideoPath,
      project.script
    );

    // 3. Match B-roll for each scene
    for (const scene of scenes) {
      if (scene.brollQuery) {
        const broll = await BrollService.searchBroll(
          scene.brollQuery,
          project.aspectRatio === '9:16' ? 'portrait' : 'landscape'
        );
        scene.brollMediaUrl = broll.videoUrl;
      }
    }

    // 4. Calculate total duration
    const totalDuration =
      transcription.length > 0
        ? Math.ceil(transcription[transcription.length - 1].endMs / 1000)
        : 30;

    const updated = await Project.findByIdAndUpdate(
      projectId,
      {
        $set: {
          transcription,
          scenes,
          duration: totalDuration,
          status: 'draft',
          progress: 0,
        },
      },
      { new: true }
    );

    return updated!;
  }

  /**
   * Executes the video render synchronously
   * Returns the completed project
   */
  public static async renderProject(
    projectId: string,
    userId: string,
    workspaceId: string
  ): Promise<IProject> {
    const project = await Project.findOne({
      _id: new mongoose.Types.ObjectId(projectId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Atomically deduct credits with idempotency key
    const idempotencyKey = `render-${project._id.toString()}-${Date.now()}`;
    await CreditService.deductCredits({
      userId,
      workspaceId,
      amount: project.creditsCost || 1,
      operation: 'generation_deduct',
      description: `Render video: ${project.title}`,
      projectId: project._id,
      idempotencyKey,
    });

    return this.executeRenderJob({
      projectId: project._id.toString(),
      userId,
      workspaceId,
    });
  }

  /**
   * Internal method to execute the actual video render
   */
  public static async executeRenderJob(jobData: {
    projectId: string;
    userId: string;
    workspaceId: string;
  }): Promise<IProject> {
    const { projectId, userId, workspaceId } = jobData;

    const project = await Project.findOne({
      _id: new mongoose.Types.ObjectId(projectId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Update status to rendering
    project.status = 'rendering';
    project.progress = 10;
    await project.save();

    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const processedDir = path.join(uploadsDir, 'processed');
    const thumbnailsDir = path.join(uploadsDir, 'thumbnails');
    const musicDir = path.join(uploadsDir, 'music');
    const sfxDir = path.join(uploadsDir, 'sfx');

    const outputFileName = `render-${project._id.toString()}-${Date.now()}.mp4`;
    const thumbFileName = `thumb-${project._id.toString()}-${Date.now()}.jpg`;

    const outputPath = path.join(processedDir, outputFileName);
    const thumbnailPath = path.join(thumbnailsDir, thumbFileName);

    try {
      // 1. Find or build input video
      let inputVideoPath = '';
      if (project.rawVideoUrl && fs.existsSync(path.resolve(process.cwd(), project.rawVideoUrl.slice(1)))) {
        inputVideoPath = path.resolve(process.cwd(), project.rawVideoUrl.slice(1));
      } else {
        // Create synthetic video generator if raw video was not locally provided
        inputVideoPath = path.join(uploadsDir, 'raw', `sample-${project._id.toString()}.mp4`);
        if (!fs.existsSync(inputVideoPath)) {
          const ffmpeg = FFmpegService.getFfmpegPath();
          const { execFile } = await import('child_process');
          const { promisify } = await import('util');
          const execFileAsync = promisify(execFile);

          const res = project.aspectRatio === '9:16' ? '1080x1920' : '1920x1080';
          await execFileAsync(ffmpeg, [
            '-y',
            '-f', 'lavfi',
            '-i', `color=c=0x11141D:s=${res}:d=${Math.max(15, project.duration || 30)}:r=30`,
            '-f', 'lavfi',
            '-i', `anullsrc=r=44100:cl=stereo`,
            '-t', `${Math.max(15, project.duration || 30)}`,
            '-c:v', 'libx264',
            '-c:a', 'aac',
            inputVideoPath,
          ]);
        }
      }

      // 2. Update progress - preparing render
      project.progress = 30;
      await project.save();

      // 3. Resolve background music path if specified
      let backgroundMusicPath: string | undefined;
      if (project.editingPreferences.backgroundMusic && project.editingPreferences.autoDucking) {
        const musicFile = `${project.editingPreferences.backgroundMusic}.mp3`;
        const candidatePath = path.join(musicDir, musicFile);
        if (fs.existsSync(candidatePath)) {
          backgroundMusicPath = candidatePath;
        }
      }

      // 4. Build audio mix options from project preferences
      const audioMix: AudioMixOptions | undefined = project.editingPreferences.backgroundMusic
        ? {
            backgroundMusicPath,
            musicVolume: project.editingPreferences.musicVolume,
            autoDucking: project.editingPreferences.autoDucking,
          }
        : undefined;

      // 5. Prepare scenes for rendering (B-roll, transitions, zoom effects)
      const renderScenes = project.scenes?.map(scene => {
        const zoomIntensity = project.editingPreferences.zoomIntensity;
        let zoomEffect: ZoomEffectOptions | undefined;
        if (zoomIntensity !== 'none') {
          zoomEffect = {
            type: zoomIntensity === 'dynamic' ? 'punch_in' : 'slow_zoom',
            intensity: zoomIntensity,
          };
        }
        
        return {
          index: scene.index,
          startMs: scene.startMs,
          endMs: scene.endMs,
          brollMediaUrl: scene.brollMediaUrl && scene.brollMediaUrl.startsWith('/uploads/')
            ? path.resolve(process.cwd(), scene.brollMediaUrl.slice(1))
            : scene.brollMediaUrl,
          brollType: scene.brollType,
          transition: scene.transition ? {
            type: scene.transition as TransitionOptions['type'],
            durationMs: 300,
          } : undefined,
          zoomEffect,
        };
      }) || [];

      // 6. Prepare color correction from editing preferences (if any custom values set)
      const colorCorrection = project.editingPreferences.highlightKeywords ? {
        brightness: 0.05,
        contrast: 1.1,
        saturation: 1.15,
        vignette: 0.15,
      } : undefined;

      // 7. Prepare sound effects - add whoosh at scene transitions
      const sfxDirPath = path.join(uploadsDir, 'sfx');
      const soundEffects: Array<{ mediaPath: string; startSec: number; volume?: number }> = [];
      
      if (renderScenes.length > 1) {
        // Add whoosh transition sound between scenes
        const whooshPath = path.join(sfxDirPath, 'whoosh.mp3');
        if (fs.existsSync(whooshPath)) {
          for (let i = 1; i < renderScenes.length; i++) {
            soundEffects.push({
              mediaPath: whooshPath,
              startSec: renderScenes[i].startMs / 1000 - 0.1,
              volume: 30,
            });
          }
        }
      }
      
      // Add pop sound at the start
      const popPath = path.join(sfxDirPath, 'pop.mp3');
      if (fs.existsSync(popPath)) {
        soundEffects.push({
          mediaPath: popPath,
          startSec: 0,
          volume: 40,
        });
      }

      // 8. Execute render with progress updates
      const renderOptions: RenderVideoOptions = {
        inputPath: inputVideoPath,
        outputPath,
        thumbnailPath,
        aspectRatio: project.aspectRatio,
        resolution: project.resolution,
        transcription: project.transcription,
        scenes: renderScenes,
        audioMix,
        soundEffects,
        colorCorrection,
        onProgress: async (p) => {
          // Map 30-95% for actual rendering
          project.progress = Math.max(30, Math.min(95, 30 + Math.round(p * 0.65)));
          await project.save();
        },
      };

      await FFmpegService.renderVideo(renderOptions);

      // 9. Mark success
      project.status = 'ready';
      project.progress = 100;
      project.outputVideoUrl = `/uploads/processed/${outputFileName}`;
      project.thumbnailUrl = `/uploads/thumbnails/${thumbFileName}`;
      project.renderError = undefined;
      await project.save();

      return project;
    } catch (err: any) {
      console.error(`💥 Render failed for project ${projectId}:`, err);

      // Refund credits automatically to guarantee user satisfaction
      await CreditService.refundCredits({
        userId,
        workspaceId,
        amount: project.creditsCost || 1,
        description: `Refund for failed render: ${project.title}`,
        projectId: project._id,
      });

      project.status = 'failed';
      project.renderError = err.message || 'Video rendering failed.';
      project.progress = 0;
      await project.save();

      throw err;
    }
  }

  /**
   * Gets the status of a render job (simplified - checks project status)
   */
  public static async getRenderJobStatus(jobId: string) {
    // Since we execute synchronously, check project by renderJobId
    const project = await Project.findOne({ renderJobId: jobId });
    if (!project) return null;

    return {
      id: jobId,
      name: 'video_render',
      state: project.status === 'ready' ? 'completed' : project.status === 'failed' ? 'failed' : 'active',
      progress: project.progress,
      stage: project.status,
      message: project.renderError,
      failedReason: project.renderError,
      returnvalue: project.status === 'ready' ? {
        projectId: project._id.toString(),
        outputVideoUrl: project.outputVideoUrl,
        thumbnailUrl: project.thumbnailUrl,
      } : undefined,
    };
  }
}

export interface JobProgress {
  stage: string;
  progress: number;
  message?: string;
}