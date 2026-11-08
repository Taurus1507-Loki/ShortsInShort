import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Project, IProject, IScene, IWordTimestamp } from '../models/Project.js';
import { getAIService } from './ai/aiService.js';
import { CreditService } from './creditService.js';
import { FFmpegService, RenderVideoOptions, AudioMixOptions } from './video/ffmpegService.js';

export interface FacelessTemplate {
  id: string;
  name: string;
  category: 'motivational' | 'educational' | 'business' | 'facts' | 'news' | 'promo' | 'storytelling' | 'finance' | 'tech' | 'history';
  description: string;
  defaultAspectRatio: '9:16' | '16:9' | '1:1';
  defaultResolution: '720p' | '1080p' | '4k';
  sceneStructure: Array<{
    type: 'hook' | 'content' | 'cta' | 'transition';
    durationEstimate: number;
    visualStyle: 'stock_video' | 'stock_image' | 'text_overlay' | 'animation';
    transition: 'cut' | 'fade' | 'zoom_in' | 'slide_left' | 'wipe';
  }>;
  defaultMusic: string;
  captionStyle: string;
  zoomIntensity: 'none' | 'subtle' | 'dynamic';
  brollIntensity: 'none' | 'low' | 'medium' | 'high';
}

export interface FacelessVideoOptions {
  script: string;
  templateId?: string;
  voiceId: string;
  language: string;
  aspectRatio: '9:16' | '16:9' | '1:1';
  resolution: '720p' | '1080p' | '4k';
  backgroundMusic?: string;
  musicVolume?: number;
  autoDucking?: boolean;
  customBrollQueries?: string[];
}

export class FacelessVideoService {
  private uploadsDir = path.resolve(process.cwd(), 'uploads');
  private templates: Map<string, FacelessTemplate> = new Map();

  constructor() {
    this.initializeTemplates();
  }

  private initializeTemplates(): void {
    const templates: FacelessTemplate[] = [
      {
        id: 'motivational_v1',
        name: 'Motivational Short',
        category: 'motivational',
        description: 'High-energy motivational video with strong hooks and uplifting visuals',
        defaultAspectRatio: '9:16',
        defaultResolution: '1080p',
        sceneStructure: [
          { type: 'hook', durationEstimate: 3, visualStyle: 'stock_video', transition: 'zoom_in' },
          { type: 'content', durationEstimate: 5, visualStyle: 'stock_video', transition: 'cut' },
          { type: 'content', durationEstimate: 5, visualStyle: 'stock_image', transition: 'fade' },
          { type: 'content', durationEstimate: 5, visualStyle: 'stock_video', transition: 'cut' },
          { type: 'cta', durationEstimate: 3, visualStyle: 'text_overlay', transition: 'fade' },
        ],
        defaultMusic: 'energetic_lofi',
        captionStyle: 'karaoke_neon',
        zoomIntensity: 'dynamic',
        brollIntensity: 'high',
      },
      {
        id: 'educational_v1',
        name: 'Educational Explainer',
        category: 'educational',
        description: 'Clear, structured educational content with diagrams and examples',
        defaultAspectRatio: '9:16',
        defaultResolution: '1080p',
        sceneStructure: [
          { type: 'hook', durationEstimate: 3, visualStyle: 'stock_video', transition: 'fade' },
          { type: 'content', durationEstimate: 7, visualStyle: 'stock_image', transition: 'cut' },
          { type: 'content', durationEstimate: 7, visualStyle: 'stock_video', transition: 'slide_left' },
          { type: 'content', durationEstimate: 7, visualStyle: 'stock_image', transition: 'cut' },
          { type: 'cta', durationEstimate: 3, visualStyle: 'text_overlay', transition: 'fade' },
        ],
        defaultMusic: 'calm_ambient',
        captionStyle: 'clean_minimal',
        zoomIntensity: 'subtle',
        brollIntensity: 'medium',
      },
      {
        id: 'business_v1',
        name: 'Business Insight',
        category: 'business',
        description: 'Professional business content with data visualization style',
        defaultAspectRatio: '9:16',
        defaultResolution: '1080p',
        sceneStructure: [
          { type: 'hook', durationEstimate: 3, visualStyle: 'stock_video', transition: 'zoom_in' },
          { type: 'content', durationEstimate: 6, visualStyle: 'stock_image', transition: 'cut' },
          { type: 'content', durationEstimate: 6, visualStyle: 'stock_video', transition: 'fade' },
          { type: 'content', durationEstimate: 6, visualStyle: 'text_overlay', transition: 'cut' },
          { type: 'cta', durationEstimate: 3, visualStyle: 'text_overlay', transition: 'fade' },
        ],
        defaultMusic: 'corporate_upbeat',
        captionStyle: 'professional',
        zoomIntensity: 'subtle',
        brollIntensity: 'medium',
      },
      {
        id: 'facts_v1',
        name: 'Facts & Trivia',
        category: 'facts',
        description: 'Quick-fire facts with engaging visuals',
        defaultAspectRatio: '9:16',
        defaultResolution: '1080p',
        sceneStructure: [
          { type: 'hook', durationEstimate: 2, visualStyle: 'stock_video', transition: 'zoom_in' },
          { type: 'content', durationEstimate: 4, visualStyle: 'stock_image', transition: 'cut' },
          { type: 'content', durationEstimate: 4, visualStyle: 'stock_video', transition: 'cut' },
          { type: 'content', durationEstimate: 4, visualStyle: 'stock_image', transition: 'cut' },
          { type: 'content', durationEstimate: 4, visualStyle: 'stock_video', transition: 'cut' },
          { type: 'cta', durationEstimate: 2, visualStyle: 'text_overlay', transition: 'fade' },
        ],
        defaultMusic: 'curious_lofi',
        captionStyle: 'karaoke_neon',
        zoomIntensity: 'dynamic',
        brollIntensity: 'high',
      },
      {
        id: 'news_v1',
        name: 'News Explainer',
        category: 'news',
        description: 'Breaking news style with authoritative tone',
        defaultAspectRatio: '9:16',
        defaultResolution: '1080p',
        sceneStructure: [
          { type: 'hook', durationEstimate: 3, visualStyle: 'stock_video', transition: 'cut' },
          { type: 'content', durationEstimate: 8, visualStyle: 'stock_video', transition: 'fade' },
          { type: 'content', durationEstimate: 8, visualStyle: 'stock_image', transition: 'cut' },
          { type: 'cta', durationEstimate: 3, visualStyle: 'text_overlay', transition: 'fade' },
        ],
        defaultMusic: 'news_urgent',
        captionStyle: 'breaking_news',
        zoomIntensity: 'subtle',
        brollIntensity: 'medium',
      },
      {
        id: 'promo_v1',
        name: 'Product Promotion',
        category: 'promo',
        description: 'Product showcase with features and benefits',
        defaultAspectRatio: '9:16',
        defaultResolution: '1080p',
        sceneStructure: [
          { type: 'hook', durationEstimate: 3, visualStyle: 'stock_video', transition: 'zoom_in' },
          { type: 'content', durationEstimate: 6, visualStyle: 'stock_image', transition: 'cut' },
          { type: 'content', durationEstimate: 6, visualStyle: 'stock_video', transition: 'slide_left' },
          { type: 'content', durationEstimate: 6, visualStyle: 'stock_image', transition: 'cut' },
          { type: 'cta', durationEstimate: 4, visualStyle: 'text_overlay', transition: 'fade' },
        ],
        defaultMusic: 'upbeat_pop',
        captionStyle: 'karaoke_neon',
        zoomIntensity: 'dynamic',
        brollIntensity: 'high',
      },
      {
        id: 'storytelling_v1',
        name: 'Storytelling',
        category: 'storytelling',
        description: 'Narrative-driven content with emotional arc',
        defaultAspectRatio: '9:16',
        defaultResolution: '1080p',
        sceneStructure: [
          { type: 'hook', durationEstimate: 4, visualStyle: 'stock_video', transition: 'fade' },
          { type: 'content', durationEstimate: 8, visualStyle: 'stock_video', transition: 'cut' },
          { type: 'content', durationEstimate: 8, visualStyle: 'stock_image', transition: 'slide_left' },
          { type: 'content', durationEstimate: 8, visualStyle: 'stock_video', transition: 'cut' },
          { type: 'cta', durationEstimate: 3, visualStyle: 'text_overlay', transition: 'fade' },
        ],
        defaultMusic: 'cinematic_ambient',
        captionStyle: 'cinematic',
        zoomIntensity: 'subtle',
        brollIntensity: 'medium',
      },
      {
        id: 'finance_v1',
        name: 'Finance Explainer',
        category: 'finance',
        description: 'Financial concepts explained simply with charts and data',
        defaultAspectRatio: '9:16',
        defaultResolution: '1080p',
        sceneStructure: [
          { type: 'hook', durationEstimate: 3, visualStyle: 'stock_video', transition: 'zoom_in' },
          { type: 'content', durationEstimate: 7, visualStyle: 'stock_image', transition: 'cut' },
          { type: 'content', durationEstimate: 7, visualStyle: 'text_overlay', transition: 'fade' },
          { type: 'content', durationEstimate: 7, visualStyle: 'stock_video', transition: 'cut' },
          { type: 'cta', durationEstimate: 3, visualStyle: 'text_overlay', transition: 'fade' },
        ],
        defaultMusic: 'corporate_ambient',
        captionStyle: 'clean_minimal',
        zoomIntensity: 'subtle',
        brollIntensity: 'medium',
      },
      {
        id: 'tech_v1',
        name: 'Tech Explainer',
        category: 'tech',
        description: 'Technology concepts with modern visuals',
        defaultAspectRatio: '9:16',
        defaultResolution: '1080p',
        sceneStructure: [
          { type: 'hook', durationEstimate: 3, visualStyle: 'stock_video', transition: 'zoom_in' },
          { type: 'content', durationEstimate: 6, visualStyle: 'stock_video', transition: 'cut' },
          { type: 'content', durationEstimate: 6, visualStyle: 'stock_image', transition: 'slide_left' },
          { type: 'content', durationEstimate: 6, visualStyle: 'stock_video', transition: 'cut' },
          { type: 'cta', durationEstimate: 3, visualStyle: 'text_overlay', transition: 'fade' },
        ],
        defaultMusic: 'tech_ambient',
        captionStyle: 'modern_tech',
        zoomIntensity: 'dynamic',
        brollIntensity: 'high',
      },
      {
        id: 'history_v1',
        name: 'History Short',
        category: 'history',
        description: 'Historical events with archival-style visuals',
        defaultAspectRatio: '9:16',
        defaultResolution: '1080p',
        sceneStructure: [
          { type: 'hook', durationEstimate: 4, visualStyle: 'stock_video', transition: 'fade' },
          { type: 'content', durationEstimate: 8, visualStyle: 'stock_image', transition: 'cut' },
          { type: 'content', durationEstimate: 8, visualStyle: 'stock_video', transition: 'slide_left' },
          { type: 'content', durationEstimate: 8, visualStyle: 'stock_image', transition: 'cut' },
          { type: 'cta', durationEstimate: 3, visualStyle: 'text_overlay', transition: 'fade' },
        ],
        defaultMusic: 'documentary_ambient',
        captionStyle: 'documentary',
        zoomIntensity: 'subtle',
        brollIntensity: 'medium',
      },
    ];

    templates.forEach(t => this.templates.set(t.id, t));
  }

  getTemplates(): FacelessTemplate[] {
    return Array.from(this.templates.values());
  }

  getTemplate(id: string): FacelessTemplate | undefined {
    return this.templates.get(id);
  }

  getTemplatesByCategory(category: FacelessTemplate['category']): FacelessTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.category === category);
  }

  /**
   * Analyze script and generate scene plan using LLM
   */
  async analyzeScriptForFaceless(script: string, templateId?: string): Promise<{
    scenes: Array<{
      index: number;
      scriptChunk: string;
      durationEstimate: number;
      brollQuery: string;
      brollType: 'video' | 'image' | 'animation';
      transition: 'cut' | 'fade' | 'zoom_in' | 'slide_left' | 'wipe';
      visualDescription: string;
      hookType: 'question' | 'statement' | 'statistic' | 'story' | 'none';
    }>;
    overallTone: string;
    estimatedDuration: number;
    suggestedTemplate?: FacelessTemplate;
  }> {
    const aiService = getAIService();
    const template = templateId ? this.getTemplate(templateId) : undefined;
    
    const schema = {
      type: 'object',
      properties: {
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number' },
              scriptChunk: { type: 'string' },
              durationEstimate: { type: 'number' },
              brollQuery: { type: 'string' },
              brollType: { type: 'string', enum: ['video', 'image', 'animation'] },
              transition: { type: 'string', enum: ['cut', 'fade', 'zoom_in', 'slide_left', 'wipe'] },
              visualDescription: { type: 'string' },
              hookType: { type: 'string', enum: ['question', 'statement', 'statistic', 'story', 'none'] },
            },
            required: ['index', 'scriptChunk', 'durationEstimate', 'brollQuery'],
          },
        },
        overallTone: { type: 'string' },
        estimatedDuration: { type: 'number' },
      },
      required: ['scenes', 'overallTone', 'estimatedDuration'],
    };

    const templateGuidance = template ? `
Template: ${template.name} (${template.category})
Scene structure: ${template.sceneStructure.map((s, i) => `${i+1}. ${s.type} (${s.durationEstimate}s, ${s.visualStyle}, ${s.transition})`).join('; ')}
Music: ${template.defaultMusic}
Caption style: ${template.captionStyle}
Zoom: ${template.zoomIntensity}
B-roll intensity: ${template.brollIntensity}
` : '';

    const prompt = `Analyze this script for a faceless short-form video and break it into scenes with B-roll suggestions:

${script}

${templateGuidance}

Each scene should be 3-10 seconds. Identify hooks, visual cues, and relevant B-roll search terms.
Match the template's scene structure and pacing if provided.
Return scenes in order with visual descriptions for stock media search.`;

    return aiService.analyzeScript(script, { temperature: 0.7 });
  }

  /**
   * Generate faceless video synchronously
   */
  async generateFacelessVideo(
    projectId: string,
    userId: string,
    workspaceId: string,
    options: FacelessVideoOptions
  ): Promise<IProject> {
    const project = await Project.findOne({
      _id: new mongoose.Types.ObjectId(projectId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!project) throw new Error('Project not found');

    // Analyze script if not already done
    if (!project.scenes || project.scenes.length === 0) {
      const analysis = await this.analyzeScriptForFaceless(options.script, options.templateId);
      project.scenes = analysis.scenes.map(s => ({
        index: s.index,
        startMs: 0,
        endMs: 0,
        scriptChunk: s.scriptChunk,
        brollQuery: s.brollQuery,
        brollType: s.brollType === 'animation' ? 'video' : s.brollType,
        transition: s.transition,
        captionText: undefined,
      }));
      project.duration = analysis.estimatedDuration;
      await project.save();
    }

    // Deduct credits (faceless costs more due to TTS + stock media)
    const creditsCost = project.creditsCost || 3;
    const idempotencyKey = `faceless-${project._id.toString()}-${Date.now()}`;
    await CreditService.deductCredits({
      userId,
      workspaceId,
      amount: creditsCost,
      operation: 'generation_deduct',
      description: `Generate faceless video: ${project.title}`,
      projectId: project._id,
      idempotencyKey,
    });

    return this.executeFacelessGeneration({
      projectId: project._id.toString(),
      userId,
      workspaceId,
      script: options.script,
      templateId: options.templateId,
      voiceId: options.voiceId,
      aspectRatio: options.aspectRatio,
      resolution: options.resolution,
      backgroundMusic: options.backgroundMusic,
      musicVolume: options.musicVolume,
      autoDucking: options.autoDucking,
    });
  }

  /**
   * Execute faceless video generation (synchronous)
   */
  async executeFacelessGeneration(jobData: {
    projectId: string;
    userId: string;
    workspaceId: string;
    script: string;
    templateId?: string;
    voiceId: string;
    aspectRatio: '9:16' | '16:9' | '1:1';
    resolution: '720p' | '1080p' | '4k';
    backgroundMusic?: string;
    musicVolume?: number;
    autoDucking?: boolean;
  }): Promise<IProject> {
    const { projectId, userId, workspaceId, script, templateId, voiceId, aspectRatio, resolution, backgroundMusic, musicVolume, autoDucking } = jobData;

    const project = await Project.findOne({
      _id: new mongoose.Types.ObjectId(projectId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!project) throw new Error('Project not found');

    const template = templateId ? this.getTemplate(templateId) : null;

    project.status = 'rendering';
    project.progress = 10;
    await project.save();

    const processedDir = path.join(this.uploadsDir, 'processed');
    const thumbnailsDir = path.join(this.uploadsDir, 'thumbnails');
    const audioDir = path.join(this.uploadsDir, 'audio');
    const brollDir = path.join(this.uploadsDir, 'broll');
    const tempDir = path.join(this.uploadsDir, 'temp');
    
    await Promise.all([
      fs.promises.mkdir(processedDir, { recursive: true }),
      fs.promises.mkdir(thumbnailsDir, { recursive: true }),
      fs.promises.mkdir(audioDir, { recursive: true }),
      fs.promises.mkdir(brollDir, { recursive: true }),
      fs.promises.mkdir(tempDir, { recursive: true }),
    ]);

    const outputFileName = `faceless-${project._id.toString()}-${Date.now()}.mp4`;
    const thumbFileName = `thumb-${project._id.toString()}-${Date.now()}.jpg`;
    const outputPath = path.join(processedDir, outputFileName);
    const thumbnailPath = path.join(thumbnailsDir, thumbFileName);

    try {
      project.progress = 20;
      await project.save();

      // 1. Generate TTS narration for full script (silent fallback if no TTS provider is configured)
      let narrationPath: string | undefined;
      const aiService = getAIService();
      try {
        const ttsProvider = aiService.getTTSProvider();

        const narrationBuffer = await ttsProvider.synthesize(script, {
          voiceId,
          language: 'en',
          outputFormat: 'mp3',
        });

        const narrationFileName = `narration-${project._id.toString()}-${Date.now()}.mp3`;
        narrationPath = path.join(audioDir, narrationFileName);
        await fs.promises.writeFile(narrationPath, narrationBuffer);
      } catch (err: any) {
        console.warn(`TTS unavailable for project ${projectId}, rendering without narration:`, err.message);
      }

      project.progress = 40;
      await project.save();

      // 2. Get narration duration (approximate from TTS or use estimation)
      const narrationDuration = project.duration || Math.ceil(script.length / 15); // ~15 chars/sec

      // 3. Search and download B-roll for each scene
      const brollService = aiService.getBrollProvider();
      const scenesWithMedia = await this.downloadBrollForScenes(
        project.scenes,
        aspectRatio,
        brollService,
        template?.brollIntensity || 'medium'
      );

      project.progress = 60;
      await project.save();

      // 4. Prepare scenes for FFmpeg render
      const renderScenes = this.prepareRenderScenes(scenesWithMedia, narrationDuration, project);

      // 5. Persist the user's audio preferences on the project
      project.editingPreferences = {
        ...project.editingPreferences,
        backgroundMusic: backgroundMusic || project.editingPreferences.backgroundMusic || template?.defaultMusic || 'energetic_lofi',
        musicVolume: musicVolume ?? project.editingPreferences.musicVolume,
        autoDucking: autoDucking ?? project.editingPreferences.autoDucking,
      };
      await project.save();

      // 6. Build approximate word-level timestamps for karaoke captions
      const words = script.split(/\s+/).filter(Boolean);
      const wordDurationMs = narrationDuration * 1000 / Math.max(1, words.length);
      const transcription: IWordTimestamp[] = words.map((word: string, i: number) => ({
        word,
        startMs: Math.round(i * wordDurationMs),
        endMs: Math.round((i + 1) * wordDurationMs),
        confidence: 1,
        highlight: false,
      }));
      project.transcription = transcription;
      await project.save();

      // 7. Create base video with the TTS narration as the primary audio track
      const baseVideoPath = await this.createSilentBaseVideo(
        project.aspectRatio,
        narrationDuration,
        project.resolution,
        narrationPath
      );

      project.progress = 70;
      await project.save();

      // 8. Render final video with background music ducked under the narration
      const backgroundMusicPath = path.join(this.uploadsDir, 'music', `${project.editingPreferences.backgroundMusic}.mp3`);
      const renderOptions: RenderVideoOptions = {
        inputPath: baseVideoPath,
        outputPath,
        thumbnailPath,
        aspectRatio: project.aspectRatio,
        resolution: project.resolution,
        transcription,
        scenes: renderScenes,
        audioMix: {
          backgroundMusicPath: fs.existsSync(backgroundMusicPath) ? backgroundMusicPath : undefined,
          musicVolume: project.editingPreferences.musicVolume,
          autoDucking: project.editingPreferences.autoDucking,
        },
        onProgress: async (p) => {
          project.progress = Math.max(70, Math.min(95, 70 + Math.round(p * 0.25)));
          await project.save();
        },
      };

      await FFmpegService.renderVideo(renderOptions);

      project.status = 'ready';
      project.progress = 100;
      project.outputVideoUrl = `/uploads/processed/${outputFileName}`;
      project.thumbnailUrl = `/uploads/thumbnails/${thumbFileName}`;
      project.renderError = undefined;
      await project.save();

      return project;
    } catch (err: any) {
      console.error(`💥 Faceless generation failed for project ${projectId}:`, err);

      await CreditService.refundCredits({
        userId,
        workspaceId,
        amount: project.creditsCost || 3,
        description: `Refund for failed faceless generation: ${project.title}`,
        projectId: project._id,
      });

      project.status = 'failed';
      project.renderError = err.message || 'Faceless video generation failed.';
      project.progress = 0;
      await project.save();

      throw err;
    }
  }

  /**
   * Download B-roll media for scenes
   */
  private async downloadBrollForScenes(
    scenes: IProject['scenes'],
    aspectRatio: string,
    brollService: any,
    intensity: string
  ): Promise<Array<{
    scene: any;
    mediaPath?: string;
    mediaUrl?: string;
  }>> {
    const results = [];
    const orientation = aspectRatio === '9:16' ? 'portrait' : 'landscape';
    const count = intensity === 'high' ? 3 : intensity === 'medium' ? 2 : 1;

    for (const scene of scenes) {
      if (!scene.brollQuery) {
        results.push({ scene });
        continue;
      }

      try {
        const brollResults = await brollService.search(scene.brollQuery, {
          orientation: orientation as 'portrait' | 'landscape' | 'square',
          count,
        });

        if (brollResults.length > 0) {
          // Download first result
          const mediaUrl = brollResults[0].videoUrl;
          const mediaExt = path.extname(new URL(mediaUrl).pathname) || '.mp4';
          const fileName = `broll-${scene.index}-${Date.now()}${mediaExt}`;
          const localPath = path.join(this.uploadsDir, 'broll', fileName);

          const response = await fetch(mediaUrl);
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            await fs.promises.writeFile(localPath, Buffer.from(buffer));
            results.push({ scene, mediaPath: localPath, mediaUrl });
          } else {
            results.push({ scene, mediaUrl });
          }
        } else {
          results.push({ scene, mediaUrl: brollResults[0]?.videoUrl });
        }
      } catch (err) {
        console.warn(`Failed to download B-roll for scene ${scene.index}:`, err);
        results.push({ scene });
      }
    }

    return results;
  }

  /**
   * Prepare scenes for FFmpeg render with timing
   */
  private prepareRenderScenes(
    scenesWithMedia: Array<{ scene: any; mediaPath?: string; mediaUrl?: string }>,
    totalDuration: number,
    project: IProject
  ): RenderVideoOptions['scenes'] {
    const sceneDuration = totalDuration / Math.max(1, scenesWithMedia.length);
    let currentTime = 0;

    return scenesWithMedia.map(({ scene, mediaPath }, i) => {
      const startMs = Math.round(currentTime * 1000);
      const endMs = Math.round((currentTime + sceneDuration) * 1000);
      currentTime += sceneDuration;

      return {
        index: scene.index || i,
        startMs,
        endMs,
        brollMediaUrl: mediaPath,
        brollType: scene.brollType || 'video',
        transition: scene.transition || 'cut',
        zoomEffect: project.editingPreferences?.zoomIntensity !== 'none' ? {
          type: project.editingPreferences.zoomIntensity === 'dynamic' ? 'punch_in' : 'slow_zoom',
          intensity: project.editingPreferences.zoomIntensity,
        } : undefined,
      };
    });
  }

  /**
   * Create a silent base video of specified duration
   */
  private async createSilentBaseVideo(
    aspectRatio: string,
    durationSec: number,
    resolution: string,
    narrationPath?: string
  ): Promise<string> {
    const ffmpeg = FFmpegService.getFfmpegPath();
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    // Calculate target resolution manually
    const resolutions: Record<string, Record<string, string>> = {
      '720p': { '9:16': '720x1280', '16:9': '1280x720', '1:1': '720x720', '4:5': '720x900' },
      '1080p': { '9:16': '1080x1920', '16:9': '1920x1080', '1:1': '1080x1080', '4:5': '1080x1350' },
      '4k': { '9:16': '2160x3840', '16:9': '3840x2160', '1:1': '2160x2160', '4:5': '2160x2700' },
    };
    const targetRes = resolutions[resolution]?.[aspectRatio] || '1080x1920';
    const outputPath = path.join(this.uploadsDir, 'temp', `silent-${uuidv4()}.mp4`);

    const args: string[] = [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=0x11141D:s=${targetRes}:d=${durationSec}:r=30`,
    ];

    if (narrationPath) {
      args.push('-i', narrationPath);
    } else {
      args.push('-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`);
    }

    args.push(
      '-t', `${durationSec}`,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      '-pix_fmt', 'yuv420p',
      outputPath,
    );

    await execFileAsync(ffmpeg, args);

    return outputPath;
  }
}

export const facelessVideoService = new FacelessVideoService();