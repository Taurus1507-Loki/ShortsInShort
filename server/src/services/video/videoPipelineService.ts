import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { Project, IProject } from '../../models/Project.js';
import { FFmpegService } from './ffmpegService.js';
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
   * Executes the automated FFmpeg rendering pipeline with atomic credit deduction & auto-refund
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

    // 1. Atomically deduct credits with idempotency key
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

    project.status = 'rendering';
    project.progress = 15;
    await project.save();

    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const processedDir = path.join(uploadsDir, 'processed');
    const thumbnailsDir = path.join(uploadsDir, 'thumbnails');

    const outputFileName = `render-${project._id.toString()}-${Date.now()}.mp4`;
    const thumbFileName = `thumb-${project._id.toString()}-${Date.now()}.jpg`;

    const outputPath = path.join(processedDir, outputFileName);
    const thumbnailPath = path.join(thumbnailsDir, thumbFileName);

    try {
      // Find or build input video
      let inputVideoPath = '';
      if (project.rawVideoUrl && fs.existsSync(path.resolve(process.cwd(), project.rawVideoUrl.slice(1)))) {
        inputVideoPath = path.resolve(process.cwd(), project.rawVideoUrl.slice(1));
      } else {
        // Create synthetic video generator if raw video was not locally provided
        inputVideoPath = path.join(uploadsDir, 'raw', `sample-${project._id.toString()}.mp4`);
        if (!fs.existsSync(inputVideoPath)) {
          // Generate a solid color placeholder short with FFmpeg
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

      // Update progress
      project.progress = 40;
      await project.save();

      // Execute render
      await FFmpegService.renderVideo({
        inputPath: inputVideoPath,
        outputPath,
        thumbnailPath,
        aspectRatio: project.aspectRatio,
        transcription: project.transcription,
        onProgress: async (p) => {
          project.progress = Math.max(40, p);
          await project.save();
        },
      });

      // Mark success
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
}
