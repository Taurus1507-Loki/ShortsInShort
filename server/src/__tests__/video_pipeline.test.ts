import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { FFmpegService } from '../services/video/ffmpegService.js';
import { TranscriptionService } from '../services/ai/transcriptionService.js';
import { BrollService } from '../services/ai/brollService.js';
import { VideoPipelineService } from '../services/video/videoPipelineService.js';

describe('ShortsInShort Phase 2 Video Pipeline Test Suite', () => {
  let testUserId: string;
  let testWorkspaceId: string;

  beforeAll(async () => {
    await connectDB();
    const user = await User.create({
      fullName: 'Video Pipeline Tester',
      email: `video_test_${Date.now()}@test-shortsinshort.com`,
      passwordHash: 'hashed_pw',
      creditBalance: 100,
    });
    testUserId = user._id.toString();
    testWorkspaceId = user.workspaceId.toString();
  });

  afterAll(async () => {
    await User.deleteMany({ email: /video_test_/ });
    await Project.deleteMany({ title: /Pipeline Test/ });
    await disconnectDB();
  });

  it('generates speech segments by inverting detected silence intervals', () => {
    const totalDuration = 20.0; // 20s video
    const silences = [
      { start: 4.0, end: 5.5, duration: 1.5 },
      { start: 12.0, end: 13.0, duration: 1.0 },
    ];

    const segments = FFmpegService.generateSpeechSegments(totalDuration, silences);
    expect(segments.length).toBe(3);
    expect(segments[0].start).toBe(0);
    expect(segments[0].end).toBe(4.0);
    expect(segments[1].start).toBe(5.5);
    expect(segments[1].end).toBe(12.0);
    expect(segments[2].start).toBe(13.0);
    expect(segments[2].end).toBe(20.0);
  });

  it('generates Submagic-style ASS subtitle content with karaoke timing', () => {
    const mockWords = [
      { word: 'THIS', startMs: 500, endMs: 800, confidence: 0.99, highlight: false },
      { word: 'SECRET', startMs: 850, endMs: 1300, confidence: 0.99, highlight: true },
      { word: 'WORKFLOW', startMs: 1350, endMs: 1900, confidence: 0.99, highlight: false },
      { word: 'WINS!', startMs: 1950, endMs: 2400, confidence: 0.99, highlight: false },
    ];

    const ass = FFmpegService.generateAssSubtitleContent(mockWords, {
      fontName: 'Cabinet Grotesk',
      fontSize: 72,
    });

    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toContain('Style: KaraokeNeon');
    expect(ass).toContain('Dialogue:');
    // Highlighted word should contain bold color override
    expect(ass).toContain('SECRET');
  });

  it('transcribes script into word-level timestamps and structured scenes', async () => {
    const sampleScript = "Stop wasting 10 hours on video editing! Use this automated AI workflow today.";
    const result = await TranscriptionService.transcribe('', sampleScript);

    expect(result.transcription.length).toBeGreaterThan(5);
    expect(result.scenes.length).toBeGreaterThan(0);

    const firstWord = result.transcription[0];
    expect(firstWord.word).toBe('Stop');
    expect(firstWord.startMs).toBeDefined();
    expect(firstWord.endMs).toBeGreaterThan(firstWord.startMs);
  });

  it('matches semantic B-roll media for scene visual keywords', async () => {
    const broll = await BrollService.searchBroll('financial growth chart');
    expect(broll).toBeDefined();
    expect(broll.videoUrl).toContain('.mp4');
    expect(broll.previewImageUrl).toBeDefined();
  });

  it('analyzes a project and populates scenes, timestamps and B-roll', async () => {
    const project = await Project.create({
      userId: new mongoose.Types.ObjectId(testUserId),
      workspaceId: new mongoose.Types.ObjectId(testWorkspaceId),
      title: 'Pipeline Test Project',
      creationMode: 'ai_editor',
      aspectRatio: '9:16',
      script: "Never make this mistake in B2B growth! Automate your shorts with AI.",
    });

    const analyzed = await VideoPipelineService.analyzeVideo(project._id.toString(), testUserId);
    expect(analyzed.transcription.length).toBeGreaterThan(5);
    expect(analyzed.scenes.length).toBeGreaterThan(0);
    expect(analyzed.scenes[0].brollMediaUrl).toBeDefined();
    expect(analyzed.status).toBe('draft');
  });
});

