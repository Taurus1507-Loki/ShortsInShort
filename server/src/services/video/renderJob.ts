import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { Project, ownedBy } from '../../models/Project.js';
import { Asset } from '../../models/Asset.js';
import type { JobDoc } from '../../models/Job.js';
import { applyCreditChange } from '../credit.service.js';
import { purgeAsset, registerGeneratedAsset } from '../asset.service.js';
import { keys, storage } from '../storage/storage.js';
import { PermanentJobError } from '../queue/queue.js';
import { registerHandler, type JobContext } from '../queue/worker.js';
import { FfmpegError, probe } from './ffmpeg.js';
import { computeKeepSegments, detectSilences, SILENCE_PRESETS, totalDuration, type Intensity } from './silence.js';
import { extractSpeechAudio, extractThumbnail, outputSize, renderVideo, resolveFraming, type AspectRatio, type Resolution } from './render.js';
import { env } from '../../config/env.js';
import { Transcript } from '../../models/Transcript.js';
import { getTranscriptionProvider, TranscriptionError, type Word } from '../ai/transcription.js';
import { fillerIntervals, mergeIntervals, remapWords } from './transcriptMap.js';
import { buildAss, layoutLines, STYLE_SPECS, type CaptionLine, type CaptionPosition, type CaptionSize, type CaptionStyle } from './captions.js';
import { getLLMProvider, LLMError, type LLMProvider } from '../ai/llm.js';
import { getStockProvider, rankClips, relevance, type StockClip, type StockVideoProvider } from '../ai/stock.js';
import { aiKeywords, matchKeyword, planBroll, timeTokens, toSentences, translateLines } from '../ai/creative.js';
import { createHash } from 'node:crypto';
import { loadLibrary, pickTrack } from '../ai/music.js';
import { planZooms, type ZoomIntensity } from './zooms.js';
import { buildWatermarkAss } from './captions.js';
import { BrandKit, LOGO_WIDTH } from '../../models/BrandKit.js';
import { Workspace } from '../../models/Workspace.js';
import { PLANS, type PlanId } from '../../config/plans.js';
import type { LogoPosition } from './render.js';
import type { AssetDoc } from '../../models/Asset.js';
import type { ProjectDoc } from '../../models/Project.js';
import { CustomVoice } from '../../models/CustomVoice.js';
import { renderBackground, renderScenes, type BackgroundKind, type SceneTransition } from './background.js';
import { mixSfx, sfxCues } from '../audio/sfx.js';
import { captionsToOutput, graphicsToOutput, keepSegments, rangeToOutput, sfxToOutput, type EditDoc } from './edl.js';
import { getGraphicsRenderer, graphicClipPath } from './graphics.js';
import { sceneTimings, scenesKey } from '../faceless/scenes.js';
import { parseMotionScene } from '../faceless/motion.js';
import { getMotionRenderer, MOTION_FPS, motionTheme } from './motionRender.js';
import { runFfmpeg } from './ffmpeg.js';
import { AvatarError, getAvatarProvider } from '../ai/avatar.js';

export interface RenderPayload {
  projectId: string;
  credits: number;
}

/** Translated captions need a translation provider (Phase 2.3); say so instead of pretending. */
function captionLanguageWarning(settings: { language?: string; captionLanguage?: string }, captionsAdded: boolean, llmConfigured: boolean): string[] {
  const target = settings.captionLanguage ?? 'same';
  // With an LLM configured, a failed translation is reported by the pipeline with the actual reason.
  if (!captionsAdded || llmConfigured || target === 'same' || target === (settings.language ?? 'en')) return [];
  return ['Captions are shown in the spoken language: caption translation is not enabled on this server yet.'];
}

/** Honest notes about requested features that were not applied to this render. */
function pendingFeatureWarnings(
  settings: { captionsEnabled?: boolean; musicMood?: string; bRollIntensity?: string },
  captions: { added: boolean; error: string | null; providerConfigured: boolean; hasAudio: boolean; musicAdded: boolean },
) {
  const w: string[] = [];
  if (settings.captionsEnabled && !captions.added) {
    if (!captions.hasAudio) w.push('Captions were not added: the video has no audio track.');
    else if (!captions.providerConfigured) w.push('Captions were not added: transcription is not enabled on this server yet.');
    else if (captions.error) w.push(`Captions were not added: ${captions.error}`);
    else w.push('Captions were not added: no speech was detected.');
  }
  if (settings.musicMood && settings.musicMood !== 'none' && !captions.musicAdded) w.push('Background music was not added: no licensed music library has been set up yet (an admin adds Pixabay tracks in Admin → Music library).');
  return w;
}

export interface UsedBroll {
  path: string;
  start: number;
  end: number;
  query: string;
  provider: string;
  pageUrl: string;
  author: string;
}

/**
 * Plans cutaways with the LLM, then searches and downloads one licensed clip per moment (no clip
 * reused within a video). Moments without a usable clip are skipped rather than failing the render.
 */
async function fetchBroll(
  llm: LLMProvider,
  stock: StockVideoProvider,
  words: Word[],
  opts: { intensity: 'low' | 'medium' | 'high'; durationSec: number; language: string; workDir: string; signal: AbortSignal },
): Promise<UsedBroll[]> {
  const moments = await planBroll(llm, toSentences(words), opts, opts.signal);
  const used = new Set<string>();
  const results = await Promise.allSettled(
    moments.map(async (m, i) => {
      // Try each search from specific to common; only accept a clip whose tags match the search.
      // Showing nothing is better than showing something unrelated.
      let clip: StockClip | undefined;
      let matchedQuery = m.query;
      for (const q of [m.query, ...(m.alternatives ?? [])]) {
        const clips = await stock.searchVideos(q, { perPage: 8, minDurationSec: Math.ceil(m.end - m.start), signal: opts.signal });
        clip = rankClips(clips, q).find((c) => !used.has(c.id) && relevance(c, q) > 0);
        if (clip) {
          matchedQuery = q;
          break;
        }
      }
      if (!clip) return null;
      used.add(clip.id);
      const file = path.join(opts.workDir, `broll-${i}.mp4`);
      await stock.download(clip, file, { signal: opts.signal });
      return { path: file, start: m.start, end: m.end, query: matchedQuery, provider: clip.provider, pageUrl: clip.pageUrl, author: clip.author };
    }),
  );
  if (opts.signal.aborted) throw new Error('Processing was cancelled.');
  return results.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
}

/**
 * Word-level transcript for the source, reused from cache when available so re-renders never pay
 * for transcription twice. Failures are non-fatal: the render continues without captions.
 */
export async function loadTranscript(
  source: AssetDoc,
  input: string,
  language: string,
  workDir: string,
  signal: AbortSignal,
): Promise<{ words: Word[] | null; error: string | null }> {
  const provider = getTranscriptionProvider();
  if (!provider) return { words: null, error: null };
  const cached = await Transcript.findOne({ assetId: source._id, provider: provider.name, language }).lean();
  if (cached) return { words: cached.words as Word[], error: null };
  try {
    const audio = path.join(workDir, 'speech.mp3');
    await extractSpeechAudio(input, audio, { signal });
    const result = await provider.transcribe(audio, { language, signal });
    await Transcript.updateOne(
      { assetId: source._id, provider: provider.name, language },
      { $set: { workspaceId: source.workspaceId, words: result.words, durationSec: source.durationSec } },
      { upsert: true },
    );
    return { words: result.words, error: null };
  } catch (err) {
    if (signal.aborted) throw err;
    logger.warn({ err, assetId: source._id.toString() }, 'Transcription failed; rendering without captions');
    return { words: null, error: err instanceof TranscriptionError ? err.message : 'transcription failed.' };
  }
}

/** Solid colour requested behind presenters that are cut out (overlay layout). */
export const KEY_GREEN = '#00B140';
let pollMs = 10_000;
/** Test seam: how often the avatar provider is polled. */
export const setAvatarPollInterval = (ms: number) => {
  pollMs = ms;
};
const PRESENTER_DEADLINE_MS = 30 * 60_000;

/**
 * The talking presenter for the current voiceover. Reuses the stored clip when nothing relevant
 * changed (no second provider charge); otherwise requests one, saving the provider's video id
 * immediately so a retried job polls that video instead of paying for another.
 */
async function ensurePresenter(
  project: ProjectDoc,
  narration: AssetDoc,
  narrationPath: string,
  workDir: string,
  ctx: { signal: AbortSignal; progress: JobContext['progress'] },
): Promise<{ path: string; reused: boolean }> {
  const provider = getAvatarProvider();
  if (!provider) throw new PermanentJobError('Talking presenters are not configured on this server.');
  const s = project.settings ?? {};
  const avatarId = s.avatarId!;
  const layout = s.avatarLayout ?? 'full';
  const backgroundColor = layout === 'overlay' ? KEY_GREEN : (s.backgroundColor ?? '#1E1B4B');
  const aspectRatio = project.aspectRatio as '9:16' | '16:9' | '1:1' | '4:5';
  const ar = project.avatarRender;
  const same = Boolean(
    ar && ar.provider === provider.name && ar.avatarId === avatarId && ar.narrationAssetId?.equals(narration._id) && ar.backgroundColor === backgroundColor && ar.aspectRatio === aspectRatio,
  );
  if (same && ar?.assetId) {
    const existing = await Asset.findOne({ _id: ar.assetId, workspaceId: project.workspaceId, deletedAt: null, status: 'ready' });
    if (existing) return { path: await storage.getProcessingInput(existing.storageKey), reused: true };
  }

  let videoId = same ? (ar?.providerVideoId ?? null) : null;
  try {
    if (!videoId) {
      await ctx.progress(5, 'requesting_presenter');
      videoId = await provider.createVideo({
        avatarId,
        audioPath: narrationPath,
        aspectRatio,
        resolution: ((s.resolution ?? '1080p') === '720p' ? '720p' : '1080p'),
        backgroundColor,
        idempotencyKey: createHash('sha1').update(`${project._id}|${narration._id}|${avatarId}|${backgroundColor}|${aspectRatio}`).digest('hex'),
        signal: ctx.signal,
      });
      await Project.updateOne(
        { _id: project._id },
        { $set: { avatarRender: { provider: provider.name, providerVideoId: videoId, avatarId, narrationAssetId: narration._id, backgroundColor, aspectRatio, assetId: null, status: 'pending', requestedAt: new Date() } } },
      );
    }
    const started = Date.now();
    for (;;) {
      if (ctx.signal.aborted) throw new Error('Processing was cancelled.');
      const v = await provider.getVideo(videoId, ctx.signal);
      if (v.status === 'failed') {
        await Project.updateOne({ _id: project._id }, { $set: { avatarRender: null } });
        throw new PermanentJobError(`The presenter video failed at the provider: ${v.failure ?? 'unknown reason'}.`);
      }
      if (v.status === 'completed' && v.videoUrl) {
        await ctx.progress(12, 'saving_presenter');
        const file = path.join(workDir, 'presenter.mp4');
        await provider.download(v.videoUrl, file, ctx.signal);
        const info = await probe(file, { signal: ctx.signal });
        if (!info.video) throw new Error('The presenter video could not be read.');
        const assetId = new Types.ObjectId();
        const key = keys.avatarVideo(project.workspaceId.toString(), assetId.toString());
        await storage.uploadFile(key, file, 'video/mp4');
        await registerGeneratedAsset({
          id: assetId,
          workspaceId: project.workspaceId as Types.ObjectId,
          projectId: project._id,
          kind: 'avatar_video',
          storageKey: key,
          mimeType: 'video/mp4',
          sizeBytes: (await stat(file)).size,
          originalName: 'presenter.mp4',
          durationSec: Math.round(info.durationSec * 1000) / 1000,
          width: info.video.width,
          height: info.video.height,
          hasAudio: Boolean(info.audio),
        });
        const previous = ar?.assetId && !same ? ar.assetId : null;
        await Project.updateOne({ _id: project._id }, { $set: { 'avatarRender.assetId': assetId, 'avatarRender.status': 'completed' } });
        if (previous) {
          const old = await Asset.findOne({ _id: previous, deletedAt: null });
          if (old) await purgeAsset(old).catch((err) => logger.warn({ err }, 'Failed to purge previous presenter clip'));
        }
        return { path: file, reused: false };
      }
      if (Date.now() - started > PRESENTER_DEADLINE_MS) throw new Error('The presenter video is taking too long at the provider. Try again later.');
      await ctx.progress(Math.min(11, 6 + Math.floor((Date.now() - started) / 60_000)), 'presenter_rendering');
      await new Promise((r) => setTimeout(r, pollMs));
    }
  } catch (err) {
    if (err instanceof AvatarError && err.permanent) throw new PermanentJobError(err.message);
    throw err;
  }
}

/**
 * Avatar Studio (voiceover video): renders the base clip — the chosen background at the final size
 * with the voiceover as audio — and returns it with the voiceover's word timings, so the rest of the
 * pipeline (captions, B-roll, zooms, logo, music) treats it like an edited source.
 */
async function prepareVoiceoverBase(project: ProjectDoc, workDir: string, signal: AbortSignal, progress: JobContext['progress']) {
  if (!project.narrationAssetId) throw new PermanentJobError('Generate the voiceover first.');
  const narration = await Asset.findOne({ _id: project.narrationAssetId, workspaceId: project.workspaceId, deletedAt: null, status: 'ready' });
  if (!narration) throw new PermanentJobError('The voiceover is missing. Generate it again.');
  const withWords = await Project.findById(project._id).select('+narrationWords').lean();
  const settings = project.settings ?? {};
  const size = outputSize(project.aspectRatio as AspectRatio, (settings.resolution ?? '1080p') as Resolution);
  const kind = (settings.background ?? 'brand') as BackgroundKind;
  let mediaPath: string | undefined;
  const fullPresenter = Boolean(settings.avatarId) && (settings.avatarLayout ?? 'full') === 'full';
  if ((kind === 'image' || kind === 'video') && !fullPresenter) {
    const bg = project.backgroundAssetId
      ? await Asset.findOne({ _id: project.backgroundAssetId, workspaceId: project.workspaceId, deletedAt: null, status: 'ready', kind: kind === 'image' ? 'background_image' : 'source_video' })
      : null;
    if (!bg) throw new PermanentJobError(`The background ${kind} is missing. Choose it again.`);
    mediaPath = await storage.getProcessingInput(bg.storageKey);
  }
  const kit = kind === 'brand' ? await BrandKit.findOne({ workspaceId: project.workspaceId }).lean() : null;
  const colors: [string, string] =
    kind === 'brand' ? [kit?.primaryColor ?? '#7C3AED', kit?.secondaryColor ?? '#0F172A'] : [settings.backgroundColor ?? '#1E1B4B', settings.backgroundColor ?? '#1E1B4B'];
  const durationSec = narration.durationSec ?? project.narrationStats?.durationSec ?? 0;
  if (!(durationSec > 0)) throw new PermanentJobError('The voiceover has no length. Generate it again.');
  const narrationPath = await storage.getProcessingInput(narration.storageKey);
  const layout = (settings.avatarLayout ?? 'full') as 'full' | 'overlay';
  const presenter = settings.avatarId ? await ensurePresenter(project, narration, narrationPath, workDir, { signal, progress }) : null;
  await progress(13, 'preparing_background');
  const input = path.join(workDir, 'base.mp4');
  await renderBackground(
    {
      kind,
      width: size.width,
      height: size.height,
      durationSec,
      audioPath: narrationPath,
      output: input,
      colors,
      mediaPath,
      presenter: presenter ? { path: presenter.path, layout, keyColor: KEY_GREEN } : undefined,
    },
    { signal },
  );
  const words = ((withWords?.narrationWords ?? []) as Array<{ text: string; start: number; end: number }>).map((w) => ({ text: w.text, start: w.start, end: w.end }));
  return { input, words: words as Word[], presenter: presenter ? { avatarId: settings.avatarId!, layout, reused: presenter.reused } : null };
}

/**
 * Faceless (stock footage): each scene's licensed clip is cut to the exact time its narration is
 * spoken, then joined under the voiceover. Returns the base clip, the word timings and the scene list
 * (for attribution).
 */
async function prepareFacelessBase(project: ProjectDoc, workDir: string, signal: AbortSignal, progress: JobContext['progress']) {
  if (!project.narrationAssetId) throw new PermanentJobError('Generate the voiceover first.');
  const narration = await Asset.findOne({ _id: project.narrationAssetId, workspaceId: project.workspaceId, deletedAt: null, status: 'ready' });
  if (!narration) throw new PermanentJobError('The voiceover is missing. Generate it again.');
  const scenes = project.scenes ?? [];
  if (!scenes.length || project.scenesKey !== scenesKey(project.script ?? '')) throw new PermanentJobError('Plan the scenes again — the script changed.');
  const withWordsEarly = project.settings?.facelessStyle === 'motion';
  if (withWordsEarly) return prepareMotionBase(project, narration, workDir, signal, progress);
  const missing = scenes.findIndex((sc) => !sc.clip?.downloadUrl && !sc.assetId);
  if (missing >= 0) throw new PermanentJobError(`Scene ${missing + 1} has no clip. Choose one first.`);
  const stock = getStockProvider();
  if (!stock && scenes.some((sc) => !sc.assetId)) throw new PermanentJobError('Stock footage is not configured on this server.');
  const withWords = await Project.findById(project._id).select('+narrationWords').lean();
  const words = ((withWords?.narrationWords ?? []) as Array<{ text: string; start: number; end: number }>).map((w) => ({ text: w.text, start: w.start, end: w.end }));
  const durationSec = narration.durationSec ?? project.narrationStats?.durationSec ?? 0;
  if (!(durationSec > 0)) throw new PermanentJobError('The voiceover has no length. Generate it again.');
  const timings = sceneTimings(scenes, words, durationSec);

  // The user's own media is read straight from storage; stock clips are downloaded.
  const files: Array<{ path: string; image: boolean }> = [];
  for (const [i, sc] of scenes.entries()) {
    await progress(4 + Math.round((i / scenes.length) * 8), 'downloading_clips');
    if (sc.assetId) {
      const own = await Asset.findOne({ _id: sc.assetId, workspaceId: project.workspaceId, deletedAt: null, status: 'ready' });
      if (!own) throw new PermanentJobError(`Scene ${i + 1}: your media file was deleted. Choose it again.`);
      files.push({ path: await storage.getProcessingInput(own.storageKey), image: own.kind === 'background_image' });
      continue;
    }
    const file = path.join(workDir, `scene-${i}.mp4`);
    await stock!.download(sc.clip as unknown as StockClip, file, { signal });
    files.push({ path: file, image: false });
  }
  await progress(12, 'assembling_scenes');
  const settings = project.settings ?? {};
  const size = outputSize(project.aspectRatio as AspectRatio, (settings.resolution ?? '1080p') as Resolution);
  const input = path.join(workDir, 'base.mp4');
  await renderScenes(
    {
      width: size.width,
      height: size.height,
      scenes: files.map((f, i) => ({ path: f.path, image: f.image, durationSec: timings[i]!.end - timings[i]!.start })),
      audioPath: await storage.getProcessingInput(narration.storageKey),
      output: input,
      transition: (settings.sceneTransition ?? 'fade') as SceneTransition,
    },
    { signal },
  );
  // Attribution only for stock footage (the user's own media needs none).
  const used = scenes.flatMap((sc, i) =>
    sc.assetId
      ? []
      : [{ path: files[i]!.path, start: timings[i]!.start, end: timings[i]!.end, query: sc.queries?.[0] ?? '', provider: sc.clip!.provider ?? '', pageUrl: sc.clip!.pageUrl ?? '', author: sc.clip!.author ?? '' }],
  );
  const titles = scenes.flatMap((sc, i) => (sc.overlayText?.trim() ? [{ start: timings[i]!.start, end: timings[i]!.end, text: sc.overlayText.trim() }] : []));
  // Whooshes on scene changes (only when scenes transition rather than hard-cut).
  const cues = settings.soundEffects === false ? [] : sfxCues(timings, { transitions: (settings.sceneTransition ?? 'fade') !== 'cut' });
  const withSfx = await mixSfx(input, path.join(workDir, 'base-sfx.mp4'), cues, { signal });
  return { input: withSfx, words: words as Word[], scenes: used, titles, sceneCount: scenes.length, sfxCount: cues.length };
}

/**
 * Motion Explainer: every scene is an animated template (Remotion, headless Chrome) lasting exactly as
 * long as its narration; the silent animation is then laid under the voiceover.
 */
async function prepareMotionBase(project: ProjectDoc, narration: AssetDoc, workDir: string, signal: AbortSignal, progress: JobContext['progress']) {
  const scenes = project.scenes ?? [];
  const parsed = scenes.map((sc) => parseMotionScene(sc.motion));
  const bad = parsed.findIndex((m) => !m);
  if (bad >= 0) throw new PermanentJobError(`Scene ${bad + 1} has no valid animation. Re-plan it or pick a template.`);
  const withWords = await Project.findById(project._id).select('+narrationWords').lean();
  const words = ((withWords?.narrationWords ?? []) as Array<{ text: string; start: number; end: number }>).map((w) => ({ text: w.text, start: w.start, end: w.end }));
  const durationSec = narration.durationSec ?? project.narrationStats?.durationSec ?? 0;
  if (!(durationSec > 0)) throw new PermanentJobError('The voiceover has no length. Generate it again.');
  const timings = sceneTimings(scenes, words, durationSec);
  const settings = project.settings ?? {};
  const size = outputSize(project.aspectRatio as AspectRatio, (settings.resolution ?? '1080p') as Resolution);
  const kit = await BrandKit.findOne({ workspaceId: project.workspaceId }).lean();

  // Captions are drawn inside the animation (word-timed, animated), so they are worked out first —
  // with the same edits, translation and AI keywords as burned-in captions.
  const captionKey = createHash('sha1').update(`motion|${project.narrationAssetId?.toString()}`).digest('hex').slice(0, 16);
  const captionPlan =
    settings.captionsEnabled !== false && words.length
      ? await planCaptionLines({ project, words: words as Word[], size, timelineKey: captionKey, llm: getLLMProvider(), signal, progress })
      : null;

  await progress(4, 'animating_scenes');
  const silent = path.join(workDir, 'motion.mp4');
  let last = 4;
  await getMotionRenderer()({
    scenes: parsed.map((m, i) => ({ ...m!, durationInFrames: Math.max(1, Math.round((timings[i]!.end - timings[i]!.start) * MOTION_FPS)) })),
    theme: motionTheme(kit?.primaryColor ?? undefined, kit?.secondaryColor ?? undefined),
    themeId: settings.motionTheme ?? 'auto',
    brand: { primary: kit?.primaryColor ?? undefined, secondary: kit?.secondaryColor ?? undefined },
    seed: motionSeed(project._id.toString()),
    captions: captionPlan?.lines.length
      ? {
          lines: captionPlan.lines.map((l) => ({ start: l.start, end: l.end, words: l.words.map((w) => ({ text: w.text, start: w.start, end: w.end })), keywords: l.keywords })),
          style: (settings.captionStyle ?? 'bold_pop') as CaptionStyle,
          position: (settings.captionPosition ?? 'bottom') as CaptionPosition,
          size: (settings.captionSize ?? 'medium') as CaptionSize,
          highlightColor: settings.highlightColor ?? '#A78BFA',
        }
      : null,
    width: size.width,
    height: size.height,
    output: silent,
    signal,
    // Animation is most of the work, so it fills most of the progress bar.
    onProgress: (f) => {
      const pct = 4 + Math.round(f * 76);
      if (pct > last) {
        last = pct;
        void progress(pct, 'animating_scenes');
      }
    },
  });
  const input = path.join(workDir, 'base.mp4');
  await runFfmpeg(['-i', silent, '-i', await storage.getProcessingInput(narration.storageKey), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', input], { signal });
  const titles = scenes.flatMap((sc, i) => (sc.overlayText?.trim() ? [{ start: timings[i]!.start, end: timings[i]!.end, text: sc.overlayText.trim() }] : []));
  // Effects timed to each template's animation (pops, ticks, typing, bell) plus whooshes between scenes.
  const cues = settings.soundEffects === false ? [] : sfxCues(timings.map((t, i) => ({ ...t, motion: parsed[i] })), { transitions: true });
  const withSfx = await mixSfx(input, path.join(workDir, 'base-sfx.mp4'), cues, { signal });
  return { input: withSfx, words: words as Word[], scenes: [] as UsedBroll[], titles, sceneCount: scenes.length, sfxCount: cues.length, captionPlan, captionKey };
}

export interface CaptionPlan {
  lines: CaptionLine[];
  captionsFromEdits: boolean;
  clearOverrides: boolean;
  aiKeywordsUsed: boolean;
  translatedTo: string | null;
  notes: string[];
}

/**
 * Caption lines for a video: the user's own edits when they still fit this cut, otherwise lines laid
 * out from the words, translated or with AI-picked keywords when available. Shared by burned-in
 * captions (FFmpeg) and captions drawn inside Motion Explainer animations (Remotion).
 */
async function planCaptionLines(opts: {
  project: ProjectDoc;
  words: Word[];
  size: { width: number; height: number };
  timelineKey: string;
  llm: LLMProvider | null;
  signal: AbortSignal;
  progress: JobContext['progress'];
}): Promise<CaptionPlan> {
  const { project, words: allWords, size, timelineKey, llm, signal } = opts;
  const settings = project.settings ?? {};
  const language = settings.language ?? 'en';
  const style = (settings.captionStyle ?? 'bold_pop') as CaptionStyle;
  const captionSize = (settings.captionSize ?? 'medium') as CaptionSize;
  const notes: string[] = [];
  let lines: CaptionLine[] = layoutLines({ words: allWords, style, width: size.width, height: size.height, size: captionSize });
  const target = settings.captionLanguage && settings.captionLanguage !== 'same' && settings.captionLanguage !== language ? settings.captionLanguage : null;
  const overrides = project.captionOverrides?.length ? project.captionOverrides : null;
  let captionsFromEdits = false;
  let clearOverrides = false;
  let aiKeywordsUsed = false;
  let translatedTo: string | null = null;
  if (overrides && project.captionOverridesKey === timelineKey) {
    // The user's edited captions, exactly as they wrote them (no AI rewriting).
    lines = overrides.map((o) => {
      const words = timeTokens(o.text, o.start, o.end);
      const k = o.keyword ? matchKeyword(words.map((w) => w.text), o.keyword) : -1;
      return { words, start: o.start, end: o.end, keywords: k >= 0 ? [k] : [] };
    });
    captionsFromEdits = true;
  } else if (overrides) {
    notes.push('Your caption edits were not used because the cut changed (for example a different editing intensity). Captions were regenerated — edit them again if needed.');
    clearOverrides = true;
  }
  if (!captionsFromEdits && llm && (target || STYLE_SPECS[style].highlight)) {
    await opts.progress(13, 'styling_captions');
    try {
      if (target) {
        lines = await translateLines(llm, lines, language, target, signal);
        translatedTo = target;
      } else {
        lines = await aiKeywords(llm, lines, language, signal);
        aiKeywordsUsed = true;
      }
    } catch (err) {
      if (signal.aborted) throw err;
      logger.warn({ err }, target ? 'Caption translation failed' : 'AI keywords failed; using rule-based highlights');
      if (target) notes.push(`Captions were not translated: ${err instanceof LLMError ? err.message : 'the AI request failed.'} They are shown in the spoken language.`);
    }
  }
  return { lines, captionsFromEdits, clearOverrides, aiKeywordsUsed, translatedTo, notes };
}

/**
 * Captions edited on the AI Video Editor timeline, moved onto the cut (exactly as the user wrote and
 * highlighted them). Translated only when a different caption language is chosen.
 */
async function timelineCaptions(
  project: ProjectDoc,
  edit: EditDoc,
  segments: Array<{ start: number; end: number }>,
  llm: LLMProvider | null,
  signal: AbortSignal,
): Promise<CaptionPlan> {
  const settings = project.settings ?? {};
  const language = settings.language ?? 'en';
  const target = settings.captionLanguage && settings.captionLanguage !== 'same' && settings.captionLanguage !== language ? settings.captionLanguage : null;
  let lines: CaptionLine[] = captionsToOutput(edit.captions ?? [], segments);
  const notes: string[] = [];
  let translatedTo: string | null = null;
  if (target && lines.length) {
    if (!llm) notes.push('Captions are shown in the spoken language: caption translation is not enabled on this server yet.');
    else {
      try {
        lines = await translateLines(llm, lines, language, target, signal);
        translatedTo = target;
      } catch (err) {
        if (signal.aborted) throw err;
        notes.push(`Captions were not translated: ${err instanceof LLMError ? err.message : 'the AI request failed.'} They are shown in the spoken language.`);
      }
    }
  }
  return { lines, captionsFromEdits: true, clearOverrides: false, aiKeywordsUsed: false, translatedTo, notes };
}

/** Same stable seed as the web app's live preview (client/src/motion/themes.ts → seedFrom). */
export function motionSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

async function run({ job, signal, progress: report }: JobContext) {
  const renderStartedAt = Date.now();
  // Never let the bar go backwards (some stages run in a different order for some video types).
  let shown = 0;
  const progress: JobContext['progress'] = (pct, stage) => {
    shown = Math.max(shown, pct);
    return report(shown, stage);
  };
  const { projectId } = job.payload as RenderPayload;
  const project = await Project.findOne({ _id: projectId, workspaceId: job.workspaceId, deletedAt: null });
  if (!project) throw new PermanentJobError('The project no longer exists.');
  const faceless = project.mode === 'faceless';
  // Voiceover-based videos (Avatar Studio and Faceless) share everything after the base clip.
  const avatar = project.mode === 'avatar' || faceless;
  let source: AssetDoc | null = null;
  if (!avatar) {
    if (!project.sourceAssetId) throw new PermanentJobError('The project has no source video.');
    source = await Asset.findOne({ _id: project.sourceAssetId, workspaceId: job.workspaceId, deletedAt: null, status: 'ready' });
    if (!source) throw new PermanentJobError('The source video is missing or was deleted.');
  }

  await Project.updateOne(ownedBy(project._id, job._id), { $set: { status: 'processing', lastError: null } });
  const workDir = await mkdtemp(path.join(tmpdir(), `sis-${job._id.toString()}-`));
  const ws = job.workspaceId as Types.ObjectId;

  try {
    // 1. Analyse
    await progress(3, avatar ? 'preparing_background' : 'analyzing');
    let input: string;
    let narrationWords: Word[] | null = null;
    let presenter: { avatarId: string; layout: string; reused: boolean } | null = null;
    let facelessScenes: UsedBroll[] | null = null;
    let titles: Array<{ start: number; end: number; text: string; position?: 'top' | 'middle' | 'bottom'; style?: 'outline' | 'box' | 'accent'; size?: 's' | 'm' | 'l'; color?: string }> = [];
    let sceneCount = 0;
    let sfxCount = 0;
    let motionCaptions: CaptionPlan | null = null;
    let motionCaptionKey: string | null = null;
    if (faceless) {
      const base = await prepareFacelessBase(project, workDir, signal, progress);
      input = base.input;
      narrationWords = base.words;
      facelessScenes = base.scenes;
      titles = base.titles;
      sceneCount = base.sceneCount;
      sfxCount = base.sfxCount;
      if ('captionPlan' in base) {
        motionCaptions = base.captionPlan ?? null;
        motionCaptionKey = base.captionKey;
      }
    } else if (avatar) {
      const base = await prepareVoiceoverBase(project, workDir, signal, progress);
      input = base.input;
      narrationWords = base.words;
      presenter = base.presenter;
    } else {
      input = await storage.getProcessingInput(source!.storageKey);
    }
    const info = await probe(input, { signal });
    if (!info.video) throw new PermanentJobError('The source file has no video track.');
    const duration = info.durationSec;

    // 2. Transcription (when a provider is configured): powers captions and filler-word removal
    const settings = project.settings ?? {};
    const intensity = (settings.editingIntensity ?? 'medium') as Intensity;
    const language = settings.language ?? 'en';
    // Voiceover videos already have exact word timings from the voice provider: no transcription.
    const providerConfigured = avatar || Boolean(getTranscriptionProvider());
    let transcript: { words: Word[] | null; error: string | null } = avatar
      ? { words: narrationWords?.length ? narrationWords : null, error: narrationWords?.length ? null : 'the voice provider returned no word timings for this voiceover.' }
      : { words: null, error: null };
    if (!avatar && info.audio && providerConfigured && (settings.captionsEnabled || intensity !== 'low')) {
      await progress(6, 'transcribing');
      transcript = await loadTranscript(source!, input, language, workDir, signal);
    }

    // 3. Silence, pause & filler-word removal
    let segments = [{ start: 0, end: duration }];
    let fillerWordsRemoved = 0;
    // The timeline editor's saved edit (same footage only) decides exactly what is kept.
    const edit = !avatar && project.edit && (project.edit as EditDoc).sourceAssetId === source?._id.toString() ? (project.edit as EditDoc) : null;
    if (edit) {
      segments = edit.segments.length ? edit.segments : keepSegments(edit);
      fillerWordsRemoved = edit.removeFillers ? edit.fillers.length : 0;
      titles = edit.texts.flatMap((t) => {
        const r = rangeToOutput(segments, t.start, t.end);
        return r ? [{ ...r, text: t.text, position: t.position, style: t.style, size: t.size, color: t.color }] : [];
      });
    } else if (info.audio && !avatar) {
      await progress(12, 'removing_silence');
      const silences = await detectSilences(input, duration, intensity, { signal, timeoutMs: Math.max(120_000, duration * 4000) });
      const fillers = transcript.words && intensity !== 'low' ? fillerIntervals(transcript.words) : [];
      fillerWordsRemoved = fillers.length;
      segments = computeKeepSegments(duration, mergeIntervals([...silences, ...fillers]), { padSec: SILENCE_PRESETS[intensity].padSec });
    }
    const keptSec = totalDuration(segments);

    // 4. Captions (AI keywords or translation) and B-roll, all on the edited timeline
    const aspectForCaptions = project.aspectRatio as AspectRatio;
    const size = outputSize(aspectForCaptions, (settings.resolution ?? '1080p') as Resolution);
    const editedWords = transcript.words?.length ? remapWords(transcript.words, segments) : [];
    const llm = getLLMProvider();
    const notes: string[] = [];
    let captions: { assPath: string; fontsDir: string } | undefined;
    let captionLines: CaptionLine[] | undefined;
    // The cut the captions are timed against; edits are only valid for the same cut.
    const timelineKey =
      motionCaptionKey ??
      createHash('sha1')
        .update(JSON.stringify(segments.map((s) => [s.start.toFixed(2), s.end.toFixed(2)])) + (avatar ? `|${project.narrationAssetId?.toString()}` : ''))
        .digest('hex')
        .slice(0, 16);
    let captionsFromEdits = false;
    let clearOverrides = false;
    let aiKeywordsUsed = false;
    let translatedTo: string | null = null;
    // Motion Explainer videos already drew their captions inside the animation (same lines).
    const drawnInAnimation = motionCaptions !== null;
    if (settings.captionsEnabled && editedWords.length) {
      const plan = motionCaptions ?? (edit?.captions?.length ? await timelineCaptions(project, edit, segments, llm, signal) : await planCaptionLines({ project, words: editedWords, size, timelineKey, llm, signal, progress }));
      ({ captionsFromEdits, clearOverrides, aiKeywordsUsed, translatedTo } = plan);
      notes.push(...plan.notes);
      captionLines = plan.lines;
    }
    if (settings.captionsEnabled && editedWords.length && captionLines && !drawnInAnimation) {
      const style = (settings.captionStyle ?? 'bold_pop') as CaptionStyle;
      const captionSize = (settings.captionSize ?? 'medium') as CaptionSize;
      const target = settings.captionLanguage && settings.captionLanguage !== 'same' && settings.captionLanguage !== language ? settings.captionLanguage : null;
      const lines = captionLines;
      const { ass } = buildAss({
        words: editedWords,
        lines,
        style,
        position: (settings.captionPosition ?? 'bottom') as CaptionPosition,
        highlightColor: settings.highlightColor ?? '#A78BFA',
        size: captionSize,
        width: size.width,
        height: size.height,
        // Edited translated captions keep the caption language's font.
        language: translatedTo ?? (captionsFromEdits && target ? target : language),
      });
      const assPath = path.join(workDir, 'captions.ass');
      await writeFile(assPath, ass, 'utf8');
      captions = { assPath, fontsDir: env.captions.fontsDir };
    }

    const brollIntensity = (settings.bRollIntensity ?? 'medium') as 'none' | 'low' | 'medium' | 'high';
    const stock = getStockProvider();
    let broll: UsedBroll[] = [];
    if (edit) {
      // Exactly the B-roll placed on the timeline (download links come from this project's clip pool).
      const placed = (edit.broll ?? []).flatMap((b) => {
        const r = rangeToOutput(segments, b.start, b.end);
        const clip = edit.brollPool?.[b.clipId];
        return r && clip && r.end - r.start >= 0.4 ? [{ r, clip, query: b.query }] : [];
      });
      if (placed.length && !stock) notes.push('B-roll was not added: stock media is not enabled on this server.');
      else if (placed.length) {
        await progress(14, 'finding_broll');
        const got = await Promise.allSettled(
          placed.map(async ({ r, clip, query }, i) => {
            const file = path.join(workDir, `broll-${i}.mp4`);
            await stock!.download({ ...clip, tags: [] }, file, { signal });
            return { path: file, start: r.start, end: r.end, query, provider: clip.provider, pageUrl: clip.pageUrl, author: clip.author };
          }),
        );
        if (signal.aborted) throw new Error('Processing was cancelled.');
        broll = got.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []));
        if (broll.length < placed.length) notes.push(`${placed.length - broll.length} B-roll clip(s) couldn’t be downloaded and were left out.`);
      }
    } else if (brollIntensity !== 'none' && !faceless) {
      if (!stock || !llm) notes.push('B-roll was not added: stock media search is not enabled on this server yet.');
      else if (!editedWords.length) notes.push('B-roll was not added: it is chosen from what you say, and no transcript was available for this video.');
      else {
        await progress(14, 'finding_broll');
        try {
          broll = await fetchBroll(llm, stock, editedWords, { intensity: brollIntensity, durationSec: keptSec, language, workDir, signal });
          if (!broll.length) notes.push('B-roll was not added: no stock clips closely matched what you say, so none were used.');
        } catch (err) {
          if (signal.aborted) throw err;
          logger.warn({ err }, 'B-roll failed; rendering without it');
          notes.push('B-roll was not added: the stock footage search failed. Try rendering again.');
        }
      }
    }

    // 4b. Zoom punch-ins (on emphasised lines; never during B-roll)
    const zoomIntensity = (settings.zoomIntensity ?? 'subtle') as ZoomIntensity;
    const zoomLines =
      captionLines ??
      (editedWords.length ? layoutLines({ words: editedWords, style: 'bold_pop', width: size.width, height: size.height }) : undefined);
    // With a timeline edit, zooms are exactly the ones placed on the timeline.
    const zooms = edit
      ? edit.zooms.flatMap((z) => {
          const r = rangeToOutput(segments, z.at, z.at + z.dur);
          return r ? [{ start: r.start, end: r.end, scale: z.scale }] : [];
        })
      : planZooms({ intensity: zoomIntensity, durationSec: keptSec, lines: zoomLines, avoid: broll });

    // 4b2. Motion graphics from the timeline: each rendered with transparency, laid over the footage.
    let graphics: Array<{ path: string; start: number; end: number }> = [];
    if (edit?.graphics?.length) {
      const placed = graphicsToOutput(edit.graphics, segments, keptSec);
      if (placed.length) {
        await progress(14, 'drawing_graphics');
        const color = settings.highlightColor ?? '#A78BFA';
        const jobs = placed.map((g, i) => {
          const { start, end, ...look } = g;
          return { graphic: { ...look, color: g.color ?? color }, durationSec: end - start, output: graphicClipPath(workDir, i) };
        });
        try {
          await getGraphicsRenderer()(jobs, outputSize(project.aspectRatio as AspectRatio, (settings.resolution ?? '1080p') as Resolution), signal);
          graphics = placed.map((g, i) => ({ path: jobs[i]!.output, start: g.start, end: g.end }));
        } catch (err) {
          if (signal.aborted) throw err;
          logger.warn({ err }, 'Motion graphics failed; rendering without them');
          notes.push('Motion graphics were not added: drawing them failed on the server. Try exporting again.');
        }
      }
    }

    // 4c. Brand Kit logo, Free-plan watermark, licensed music
    const wsDoc = await Workspace.findById(job.workspaceId).select('plan').lean();
    const plan = PLANS[(wsDoc?.plan ?? 'free') as PlanId];
    let logo: { path: string; position: LogoPosition; widthFrac: number; opacity: number } | undefined;
    if (settings.useBrandKit !== false) {
      const kit = await BrandKit.findOne({ workspaceId: job.workspaceId }).lean();
      const logoAsset = kit?.logoAssetId ? await Asset.findOne({ _id: kit.logoAssetId, workspaceId: job.workspaceId, deletedAt: null, status: 'ready' }) : null;
      if (kit && logoAsset) {
        logo = {
          path: await storage.getProcessingInput(logoAsset.storageKey),
          position: kit.logoPosition as LogoPosition,
          widthFrac: LOGO_WIDTH[kit.logoSize as keyof typeof LOGO_WIDTH] ?? 0.18,
          opacity: kit.logoOpacity,
        };
      }
    }
    // Overlay layer: Free-plan watermark and, for voiceover videos, an "AI-generated voice" label
    // (always shown when a cloned voice was used).
    const clonedVoice = avatar && project.narrationStats?.voiceId ? await CustomVoice.exists({ workspaceId: job.workspaceId, providerVoiceId: project.narrationStats.voiceId }) : null;
    // A digital presenter is always disclosed, like a cloned voice.
    const disclosure =
      avatar && (settings.disclosure !== false || clonedVoice || presenter)
        ? { text: presenter ? 'AI-generated' : 'AI-generated voice', corner: (logo?.position === 'top-left' ? 'bottom-left' : 'top-left') as 'top-left' | 'bottom-left' }
        : null;
    let watermark: { assPath: string; fontsDir: string } | undefined;
    if (plan.watermark || disclosure || titles.length) {
      const wmPath = path.join(workDir, 'watermark.ass');
      await writeFile(wmPath, buildWatermarkAss({ width: size.width, height: size.height, durationSec: keptSec, watermark: plan.watermark, disclosure, titles }), 'utf8');
      watermark = { assPath: wmPath, fontsDir: env.captions.fontsDir };
    }
    // The timeline's music choice wins; otherwise the project's mood picks a track.
    const em = edit?.music ?? null;
    const library = loadLibrary();
    const track = em
      ? em.mode === 'none'
        ? null
        : em.mode === 'track'
          ? (library.find((t) => t.file === em.file) ?? null)
          : pickTrack(library, settings.musicMood && settings.musicMood !== 'none' ? settings.musicMood : 'auto', project.style, project._id.toString())
      : settings.musicMood && settings.musicMood !== 'none'
        ? pickTrack(library, settings.musicMood, project.style, project._id.toString())
        : null;
    // ~0.25 sits a mastered track roughly 8 dB under normalised speech; ducking dips it further while talking.
    const music = track ? { path: track.path, volume: em ? em.volume : 0.25, duck: em ? em.duck : true } : undefined;

    // 5. Render (cut + reframe + zooms + B-roll + logo + captions + watermark + audio) — 15% → 88%
    await progress(15, 'rendering');
    const aspect = project.aspectRatio as AspectRatio;
    const resolution = (project.settings?.resolution ?? '1080p') as Resolution;
    const framing = resolveFraming((settings.framing ?? 'auto') as 'auto' | 'crop' | 'blur', info.video, aspect);
    const outFile = path.join(workDir, 'output.mp4');
    let lastReported = 15;
    await renderVideo(
      { input, output: outFile, segments, sourceDurationSec: duration, hasAudio: Boolean(info.audio), aspect, resolution, captions, framing, broll, graphics, zooms, logo, watermark, music },
      {
        signal,
        timeoutMs: Math.max(5 * 60_000, keptSec * 20_000),
        onFraction: (f) => {
          const pct = 15 + f * 73;
          if (pct - lastReported >= 3) {
            lastReported = pct;
            void progress(pct, 'rendering');
          }
        },
      },
    );

    // 4b. Timeline sound effects (whooshes, pops, impacts), mixed under the finished audio.
    let finalFile = outFile;
    if (edit?.sfx?.length) {
      const cues = sfxToOutput(edit.sfx, segments).filter((c) => c.at < keptSec - 0.05);
      const hasAudio = Boolean(info.audio) || Boolean(music);
      if (cues.length && hasAudio) {
        finalFile = await mixSfx(outFile, path.join(workDir, 'output-sfx.mp4'), cues, { signal });
        sfxCount = cues.length;
      } else if (cues.length) notes.push('Sound effects were not added: this video has no sound track to mix them into.');
    }

    // 4. Quality checks on the actual output
    await progress(90, 'finalizing');
    const out = await probe(finalFile, { signal });
    const expected = outputSize(aspect, resolution);
    if (!out.video || out.video.width !== expected.width || out.video.height !== expected.height) {
      throw new Error('Rendered video failed validation (unexpected dimensions).');
    }
    if (Math.abs(out.durationSec - keptSec) > Math.max(1.5, keptSec * 0.05)) {
      throw new Error(`Rendered video failed validation (duration ${out.durationSec.toFixed(1)}s, expected ${keptSec.toFixed(1)}s).`);
    }
    const thumbFile = path.join(workDir, 'thumb.jpg');
    await extractThumbnail(finalFile, thumbFile, Math.min(out.durationSec / 3, 3), { signal });

    // 5. Store outputs (not if the user stopped the export meanwhile: they were refunded)
    await progress(95, 'saving');
    if (signal.aborted) throw new Error('Processing was cancelled.');
    const renderId = new Types.ObjectId();
    const thumbId = new Types.ObjectId();
    const renderKey = keys.render(ws.toString(), renderId.toString());
    const thumbKey = keys.thumbnail(ws.toString(), thumbId.toString());
    await storage.uploadFile(renderKey, finalFile, 'video/mp4');
    await storage.uploadFile(thumbKey, thumbFile, 'image/jpeg');
    const baseName = project.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'video';
    await registerGeneratedAsset({
      id: thumbId,
      workspaceId: ws,
      projectId: project._id,
      kind: 'thumbnail',
      storageKey: thumbKey,
      mimeType: 'image/jpeg',
      sizeBytes: (await stat(thumbFile)).size,
      originalName: `${baseName}.jpg`,
    });
    await registerGeneratedAsset({
      id: renderId,
      workspaceId: ws,
      projectId: project._id,
      kind: 'render',
      storageKey: renderKey,
      mimeType: 'video/mp4',
      sizeBytes: (await stat(finalFile)).size,
      originalName: `${baseName}.mp4`,
      durationSec: Math.round(out.durationSec * 1000) / 1000,
      width: out.video.width,
      height: out.video.height,
      hasAudio: Boolean(out.audio),
      thumbnailAssetId: thumbId,
    });

    // Replace the previous render (its storage is freed).
    const previousOutput = project.outputAssetId;
    // Burned in by FFmpeg, or drawn inside a Motion Explainer animation.
    const captionsShown = Boolean(captions) || (drawnInAnimation && Boolean(captionLines?.length));
    const stats = {
      sourceDurationSec: Math.round(duration * 10) / 10,
      outputDurationSec: Math.round(out.durationSec * 10) / 10,
      silenceRemovedSec: Math.round((duration - keptSec) * 10) / 10,
      cuts: Math.max(0, segments.length - 1),
      creditsCharged: (job.payload as RenderPayload).credits,
      captionsAdded: captionsShown,
      fillerWordsRemoved,
      framing,
      brollCount: facelessScenes ? facelessScenes.length : broll.length,
      broll: (facelessScenes ?? broll).map(({ path: _p, ...b }) => b),
      sceneCount,
      titleCount: titles.length,
      facelessStyle: faceless ? (settings.facelessStyle ?? 'stock') : null,
      sceneTransition: faceless && settings.facelessStyle !== 'motion' ? (settings.sceneTransition ?? 'fade') : null,
      sfxCount,
      renderMs: Date.now() - renderStartedAt,
      aiKeywords: aiKeywordsUsed,
      captionsTranslatedTo: translatedTo,
      captionsFromEdits,
      zoomCount: zooms.length,
      graphicCount: graphics.length,
      logoApplied: Boolean(logo),
      watermark: plan.watermark,
      disclosure: Boolean(disclosure),
      presenter,
      background: avatar ? (settings.background ?? 'brand') : null,
      music: track ? { title: track.title, artist: track.artist, license: track.license } : null,
      warnings: [
        ...(translatedTo ? [] : captionLanguageWarning(settings, captionsShown, Boolean(llm))),
        ...notes,
        ...pendingFeatureWarnings(settings, {
        added: captionsShown,
        error: transcript.error,
        providerConfigured,
        hasAudio: Boolean(info.audio),
        musicAdded: Boolean(track),
        }),
      ],
    };
    // Only while this job still owns the project (a stopped export has restored it already).
    await Project.updateOne(
      ownedBy(project._id, job._id),
      {
        $set: {
          status: 'completed',
          outputAssetId: renderId,
          lastRenderedAt: new Date(),
          lastError: null,
          renderStats: stats,
          captionLines: (captionLines ?? []).map((l) => ({ start: l.start, end: l.end, text: l.words.map((w) => w.text).join(' ').slice(0, 160), keyword: l.keywords[0] !== undefined ? (l.words[l.keywords[0]]?.text ?? '') : '' })),
          captionTimelineKey: timelineKey,
          ...(clearOverrides ? { captionOverrides: null, captionOverridesKey: null } : {}),
        },
      },
    );
    if (previousOutput && !previousOutput.equals(renderId)) {
      const prev = await Asset.findOne({ _id: previousOutput, deletedAt: null });
      if (prev) await purgeAsset(prev).catch((err) => logger.warn({ err }, 'Failed to purge previous render'));
    }
    return { outputAssetId: renderId.toString(), ...stats };
  } catch (err) {
    // Inputs FFmpeg cannot decode won't succeed on retry.
    if (err instanceof FfmpegError && /Invalid data found|moov atom not found|could not find codec/i.test(err.stderrTail)) {
      throw new PermanentJobError('The source video could not be decoded.');
    }
    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Final failure: mark the project failed and refund the reserved credits exactly once. */
async function onDead(job: JobDoc) {
  const { projectId, credits } = job.payload as RenderPayload;
  await Project.updateOne(
    { _id: projectId, lastJobId: job._id },
    { $set: { status: 'failed', lastError: friendlyError(job.lastError) } },
  );
  if (credits > 0) {
    await applyCreditChange({
      workspaceId: job.workspaceId as Types.ObjectId,
      type: 'refund',
      amount: credits,
      idempotencyKey: `refund:${job._id.toString()}`,
      note: 'Refund for failed render',
      reference: { kind: 'job', id: job._id.toString() },
    });
  }
}

function friendlyError(raw: string | null | undefined): string {
  const msg = raw ?? '';
  if (/decod|no video track|missing or was deleted|no longer exists|no source video/i.test(msg)) return msg;
  if (/timed out/i.test(msg)) return 'Processing took too long and was stopped. Your credits were refunded.';
  return 'Processing failed. Your credits were refunded — please try again.';
}

export function registerRenderJob() {
  registerHandler('render_project', { run, onDead });
}
