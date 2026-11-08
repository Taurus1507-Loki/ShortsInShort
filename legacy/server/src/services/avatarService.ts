import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AvatarConsent, IAvatarConsent, ConsentStatus } from '../models/AvatarConsent.js';
import { Project, IProject } from '../models/Project.js';
import { User } from '../models/User.js';
import { getAIService } from './ai/aiService.js';
import { CreditService } from './creditService.js';
import { FFmpegService, AudioMixOptions } from './video/ffmpegService.js';

export class AvatarService {
  private uploadsDir = path.resolve(process.cwd(), 'uploads');
  private avatarsDir = path.join(this.uploadsDir, 'avatars');
  private voicesDir = path.join(this.uploadsDir, 'voices');

  constructor() {
    [this.avatarsDir, this.voicesDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Upload and store profile image for avatar creation
   */
  async uploadProfileImage(userId: string, file: Express.Multer.File): Promise<string> {
    const ext = path.extname(file.originalname) || '.jpg';
    const fileName = `avatar-${userId}-${Date.now()}-${uuidv4()}${ext}`;
    const destPath = path.join(this.avatarsDir, fileName);
    
    await fs.promises.copyFile(file.path, destPath);
    await fs.promises.unlink(file.path).catch(() => {});
    
    return `/uploads/avatars/${fileName}`;
  }

  /**
   * Upload and store voice sample for avatar creation
   */
  async uploadVoiceSample(userId: string, file: Express.Multer.File): Promise<string> {
    const ext = path.extname(file.originalname) || '.mp3';
    const fileName = `voice-${userId}-${Date.now()}-${uuidv4()}${ext}`;
    const destPath = path.join(this.voicesDir, fileName);
    
    await fs.promises.copyFile(file.path, destPath);
    await fs.promises.unlink(file.path).catch(() => {});
    
    return `/uploads/voices/${fileName}`;
  }

  /**
   * Create avatar consent record (starts the consent workflow)
   */
  async createConsentRecord(userId: string, data: {
    avatarName: string;
    provider: 'heygen' | 'd_id' | 'synclabs' | 'elevenlabs';
    profileImageUrl: string;
    voiceSampleUrl?: string;
    explicitConsentGiven: boolean;
    legalDeclarationSigned: boolean;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<IAvatarConsent> {
    // Check subscription limits for number of avatars
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    
    const activeAvatars = await AvatarConsent.countDocuments({
      userId: new mongoose.Types.ObjectId(userId),
      status: 'active',
    });

    const maxAvatars = this.getMaxAvatarsForPlan(user.planTier);
    if (activeAvatars >= maxAvatars) {
      throw new Error(`Avatar limit reached for ${user.planTier} plan (max: ${maxAvatars})`);
    }

    const consent = await AvatarConsent.create({
      userId: new mongoose.Types.ObjectId(userId),
      avatarName: data.avatarName,
      provider: data.provider,
      profileImageUrl: data.profileImageUrl,
      voiceSampleUrl: data.voiceSampleUrl,
      explicitConsentGiven: data.explicitConsentGiven,
      legalDeclarationSigned: data.legalDeclarationSigned,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      status: data.explicitConsentGiven && data.legalDeclarationSigned ? 'active' : 'pending_verification',
      consentTimestamp: new Date(),
    });

    return consent;
  }

  /**
   * Get user's avatars with consent status
   */
  async getUserAvatars(userId: string): Promise<IAvatarConsent[]> {
    return AvatarConsent.find({
      userId: new mongoose.Types.ObjectId(userId),
    }).sort({ createdAt: -1 });
  }

  /**
   * Get specific avatar by ID (with ownership check)
   */
  async getAvatar(userId: string, avatarId: string): Promise<IAvatarConsent | null> {
    return AvatarConsent.findOne({
      _id: new mongoose.Types.ObjectId(avatarId),
      userId: new mongoose.Types.ObjectId(userId),
    });
  }

  /**
   * Update avatar consent (e.g., revoke consent)
   */
  async updateAvatarConsent(userId: string, avatarId: string, data: {
    status?: ConsentStatus;
    notes?: string;
  }): Promise<IAvatarConsent | null> {
    const consent = await this.getAvatar(userId, avatarId);
    if (!consent) return null;

    if (data.status) {
      consent.status = data.status;
      if (data.status === 'revoked') {
        // Trigger avatar deletion from provider
        await this.deleteAvatarFromProvider(consent);
      }
    }
    if (data.notes) {
      consent.notes = data.notes;
    }

    await consent.save();
    return consent;
  }

  /**
   * Create avatar with provider (HeyGen, etc.)
   */
  async createAvatarWithProvider(consentId: string): Promise<IAvatarConsent> {
    const consent = await AvatarConsent.findById(consentId);
    if (!consent) throw new Error('Consent record not found');
    if (consent.status !== 'active') throw new Error('Consent not active');

    const aiService = getAIService();
    const provider = aiService.getAvatarProvider();

    const imagePath = path.resolve(process.cwd(), consent.profileImageUrl.slice(1));
    const imageBuffer = fs.readFileSync(imagePath);

    let voiceBuffer: Buffer | undefined;
    if (consent.voiceSampleUrl) {
      const voicePath = path.resolve(process.cwd(), consent.voiceSampleUrl.slice(1));
      if (fs.existsSync(voicePath)) {
        voiceBuffer = fs.readFileSync(voicePath);
      }
    }

    const result = await provider.createAvatar({
      name: consent.avatarName,
      imageFile: imageBuffer,
      voiceFile: voiceBuffer,
      consentRecordId: consent._id.toString(),
    });

    consent.externalAvatarId = result.id;
    consent.status = result.status === 'ready' ? 'active' : 'pending_verification';
    await consent.save();

    return consent;
  }

  /**
   * Generate avatar video synchronously
   */
  async generateAvatarVideo(projectId: string, userId: string, workspaceId: string, data: {
    avatarId: string;
    script: string;
    language: string;
    voiceId: string;
    aspectRatio: '9:16' | '16:9' | '1:1';
    resolution: '720p' | '1080p' | '4k';
    backgroundUrl?: string;
  }): Promise<IProject> {
    const project = await Project.findOne({
      _id: new mongoose.Types.ObjectId(projectId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!project) throw new Error('Project not found');

    const consent = await this.getAvatar(userId, data.avatarId);
    if (!consent) throw new Error('Avatar not found or access denied');
    if (!consent.externalAvatarId) throw new Error('Avatar not created with provider yet');
    if (consent.status !== 'active') throw new Error('Avatar consent not active');

    // Deduct credits
    const idempotencyKey = `avatar-${project._id.toString()}-${Date.now()}`;
    await CreditService.deductCredits({
      userId,
      workspaceId,
      amount: project.creditsCost || 2,
      operation: 'avatar_generation',
      description: `Generate avatar video: ${project.title}`,
      projectId: project._id,
      idempotencyKey,
    });

    return this.executeAvatarVideoGeneration({
      projectId: project._id.toString(),
      userId,
      workspaceId,
      avatarId: data.avatarId,
      script: data.script,
      language: data.language,
      voiceId: data.voiceId,
      aspectRatio: data.aspectRatio,
      resolution: data.resolution,
      backgroundUrl: data.backgroundUrl,
    });
  }

  /**
   * Execute avatar video generation (synchronous)
   */
  async executeAvatarVideoGeneration(jobData: {
    projectId: string;
    userId: string;
    workspaceId: string;
    avatarId: string;
    script: string;
    language: string;
    voiceId: string;
    aspectRatio: '9:16' | '16:9' | '1:1';
    resolution: '720p' | '1080p' | '4k';
    backgroundUrl?: string;
  }): Promise<IProject> {
    const { projectId, userId, workspaceId, avatarId, script, language, voiceId, aspectRatio, resolution } = jobData;

    const project = await Project.findOne({
      _id: new mongoose.Types.ObjectId(projectId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!project) throw new Error('Project not found');

    const consent = await this.getAvatar(userId, avatarId);
    if (!consent || !consent.externalAvatarId) throw new Error('Avatar not ready');

    project.status = 'rendering';
    project.progress = 10;
    await project.save();

    const processedDir = path.join(this.uploadsDir, 'processed');
    const thumbnailsDir = path.join(this.uploadsDir, 'thumbnails');
    const outputFileName = `avatar-${project._id.toString()}-${Date.now()}.mp4`;
    const thumbFileName = `thumb-${project._id.toString()}-${Date.now()}.jpg`;
    const outputPath = path.join(processedDir, outputFileName);
    const thumbnailPath = path.join(thumbnailsDir, thumbFileName);

    try {
      project.progress = 30;
      await project.save();

      const aiService = getAIService();
      const provider = aiService.getAvatarProvider();

      const result = await provider.generateVideo({
        avatarId: consent.externalAvatarId!,
        script,
        voiceId,
        language,
        aspectRatio: project.aspectRatio,
        resolution: project.resolution,
      });

      project.progress = 70;
      await project.save();

      // Download the generated video
      const videoResponse = await fetch(result.videoUrl);
      if (!videoResponse.ok) throw new Error('Failed to download generated video');
      const videoBuffer = await videoResponse.arrayBuffer();
      await fs.promises.writeFile(outputPath, Buffer.from(videoBuffer));

      // Download thumbnail
      if (result.thumbnailUrl) {
        const thumbResponse = await fetch(result.thumbnailUrl);
        if (thumbResponse.ok) {
          const thumbBuffer = await thumbResponse.arrayBuffer();
          await fs.promises.writeFile(thumbnailPath, Buffer.from(thumbBuffer));
        }
      }

      // Generate captions for the avatar video using transcription
      const transcription = this.scriptToTranscription(script, result.duration || 30);

      // Post-process with FFmpeg for captions, music, etc.
      const { FFmpegService } = await import('./video/ffmpegService.js');
      await FFmpegService.renderVideo({
        inputPath: outputPath,
        outputPath,
        thumbnailPath,
        aspectRatio: project.aspectRatio,
        resolution: project.resolution,
        transcription,
        audioMix: project.editingPreferences.backgroundMusic ? {
          backgroundMusicPath: path.join(this.uploadsDir, 'music', `${project.editingPreferences.backgroundMusic}.mp3`),
          musicVolume: project.editingPreferences.musicVolume,
          autoDucking: project.editingPreferences.autoDucking,
        } : undefined,
      });

      project.status = 'ready';
      project.progress = 100;
      project.outputVideoUrl = `/uploads/processed/${outputFileName}`;
      project.thumbnailUrl = `/uploads/thumbnails/${thumbFileName}`;
      project.renderError = undefined;
      await project.save();

      return project;
    } catch (err: any) {
      console.error(`💥 Avatar video generation failed for project ${projectId}:`, err);

      await CreditService.refundCredits({
        userId,
        workspaceId,
        amount: project.creditsCost || 2,
        description: `Refund for failed avatar generation: ${project.title}`,
        projectId: project._id,
      });

      project.status = 'failed';
      project.renderError = err.message || 'Avatar video generation failed.';
      project.progress = 0;
      await project.save();

      throw err;
    }
  }

  /**
   * Convert script to word timestamps for caption generation
   */
  private scriptToTranscription(script: string, durationSec: number): Array<{
    word: string;
    startMs: number;
    endMs: number;
    confidence: number;
    highlight: boolean;
  }> {
    const words = script.split(/\s+/).filter(w => w.length > 0);
    const wordDuration = (durationSec * 1000) / words.length;
    
    return words.map((word, i) => ({
      word: word.replace(/[.,!?]/g, ''),
      startMs: Math.round(i * wordDuration),
      endMs: Math.round((i + 1) * wordDuration),
      confidence: 1.0,
      highlight: word.includes('!') || word.includes('?') || i < 3,
    }));
  }

  /**
   * Delete avatar from provider
   */
  private async deleteAvatarFromProvider(consent: IAvatarConsent): Promise<void> {
    if (!consent.externalAvatarId) return;

    const aiService = getAIService();
    const provider = aiService.getAvatarProvider();
    
    try {
      await provider.deleteAvatar(consent.externalAvatarId);
      consent.externalAvatarId = undefined;
      await consent.save();
    } catch (err) {
      console.warn(`Failed to delete avatar from provider:`, err);
    }
  }

  /**
   * Get max avatars allowed for subscription plan
   */
  private getMaxAvatarsForPlan(plan: string): number {
    const limits: Record<string, number> = {
      'free': 0,
      'starter': 1,
      'creator': 3,
      'pro': 5,
      'agency': 15,
    };
    return limits[plan] || 0;
  }

  /**
   * Get available avatar providers
   */
  getProviderStatus() {
    const aiService = getAIService();
    return aiService.getProviderStatus().avatar;
  }
}

export const avatarService = new AvatarService();