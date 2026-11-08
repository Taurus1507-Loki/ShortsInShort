import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { IWordTimestamp, AspectRatio } from '../../models/Project.js';

const execFileAsync = promisify(execFile);

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  aspectRatio: string;
  fps: number;
  hasAudio: boolean;
}

export interface SilenceInterval {
  start: number;
  end: number;
  duration: number;
}

export interface SpeechSegment {
  start: number;
  end: number;
  duration: number;
}

export interface AssSubtitleOptions {
  fontName?: string;
  fontSize?: number;
  primaryColor?: string;
  highlightColor?: string;
  alignment?: number;
  marginV?: number;
  resolution?: { width: number; height: number };
}

export interface AudioMixOptions {
  backgroundMusicPath?: string;
  musicVolume?: number;
  autoDucking?: boolean;
  duckThresholdDb?: number;
  duckRatio?: number;
  duckAttackMs?: number;
  duckReleaseMs?: number;
}

export interface TransitionOptions {
  type: 'cut' | 'fade' | 'zoom_in' | 'slide_left' | 'wipe';
  durationMs?: number;
}

export interface ZoomEffectOptions {
  type: 'punch_in' | 'ken_burns' | 'slow_zoom' | 'none';
  intensity?: 'subtle' | 'dynamic';
  startScale?: number;
  endScale?: number;
  durationMs?: number;
}

export interface BrollOverlayOptions {
  mediaPath: string;
  startSec: number;
  endSec: number;
  transition?: TransitionOptions;
  opacity?: number;
  scale?: number;
  position?: 'center' | 'top' | 'bottom' | 'left' | 'right';
}

export interface ColorCorrectionOptions {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;
  temperature?: number;
  tint?: number;
  vignette?: number;
}

export interface SoundEffectOptions {
  mediaPath: string;
  startSec: number;
  volume?: number;
}

export interface RenderVideoOptions {
  inputPath: string;
  outputPath: string;
  thumbnailPath: string;
  aspectRatio: AspectRatio;
  resolution?: '720p' | '1080p' | '4k';
  transcription?: IWordTimestamp[];
  scenes?: Array<{
    index: number;
    startMs: number;
    endMs: number;
    brollMediaUrl?: string;
    brollType?: 'video' | 'image' | 'avatar' | 'raw';
    transition?: TransitionOptions;
    zoomEffect?: ZoomEffectOptions;
  }>;
  audioMix?: AudioMixOptions;
  soundEffects?: SoundEffectOptions[];
  colorCorrection?: ColorCorrectionOptions;
  onProgress?: (progress: number) => void;
}

export class FFmpegService {
  public static getFfmpegPath(): string {
    return process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string) || 'ffmpeg';
  }

  public static getFfprobePath(): string {
    return process.env.FFPROBE_PATH || ffprobeInstaller.path || 'ffprobe';
  }

  public static async getVideoMetadata(filePath: string): Promise<VideoMetadata> {
    const ffprobe = this.getFfprobePath();
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    try {
      const { stdout } = await execFileAsync(ffprobe, args);
      const data = JSON.parse(stdout);

      const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
      const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');

      const duration = parseFloat(data.format?.duration || videoStream?.duration || '0');
      const width = videoStream?.width || 1080;
      const height = videoStream?.height || 1920;

      let fps = 30;
      if (videoStream?.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
        if (den && den > 0) fps = Math.round(num / den);
      }

      return {
        duration,
        width,
        height,
        aspectRatio: `${width}:${height}`,
        fps,
        hasAudio: !!audioStream,
      };
    } catch (err: any) {
      console.warn(`[FFprobe] Metadata inspection warning on ${filePath}: ${err.message}`);
      return {
        duration: 30,
        width: 1080,
        height: 1920,
        aspectRatio: '9:16',
        fps: 30,
        hasAudio: true,
      };
    }
  }

  public static async detectSilences(
    filePath: string,
    thresholdDb: number = -30,
    minDurationSec: number = 0.4
  ): Promise<SilenceInterval[]> {
    const ffmpeg = this.getFfmpegPath();
    const args = [
      '-i', filePath,
      '-af', `silencedetect=noise=${thresholdDb}dB:d=${minDurationSec}`,
      '-f', 'null',
      '-',
    ];

    return new Promise((resolve) => {
      const proc = spawn(ffmpeg, args);
      let stderrOutput = '';

      proc.stderr.on('data', (chunk) => {
        stderrOutput += chunk.toString();
      });

      proc.on('close', () => {
        const silences: SilenceInterval[] = [];
        const silenceStartRegex = /silence_start:\s+([\d.]+)/g;
        const silenceEndRegex = /silence_end:\s+([\d.]+)\s+\|\s+silence_duration:\s+([\d.]+)/g;

        const starts: number[] = [];
        let match: RegExpExecArray | null;

        while ((match = silenceStartRegex.exec(stderrOutput)) !== null) {
          starts.push(parseFloat(match[1]));
        }

        let i = 0;
        while ((match = silenceEndRegex.exec(stderrOutput)) !== null) {
          const end = parseFloat(match[1]);
          const duration = parseFloat(match[2]);
          const start = starts[i] !== undefined ? starts[i] : Math.max(0, end - duration);
          silences.push({ start, end, duration });
          i++;
        }

        resolve(silences);
      });

      proc.on('error', (err) => {
        console.warn('[FFmpeg] silencedetect execution warning:', err.message);
        resolve([]);
      });
    });
  }

  public static generateSpeechSegments(
    totalDuration: number,
    silences: SilenceInterval[]
  ): SpeechSegment[] {
    if (!silences || silences.length === 0) {
      return [{ start: 0, end: totalDuration, duration: totalDuration }];
    }

    const segments: SpeechSegment[] = [];
    let currentPos = 0;

    for (const silence of silences) {
      if (silence.start > currentPos + 0.1) {
        segments.push({
          start: currentPos,
          end: silence.start,
          duration: silence.start - currentPos,
        });
      }
      currentPos = silence.end;
    }

    if (currentPos < totalDuration - 0.1) {
      segments.push({
        start: currentPos,
        end: totalDuration,
        duration: totalDuration - currentPos,
      });
    }

    return segments;
  }

  public static formatAssTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const centis = Math.floor((seconds % 1) * 100);

    const pad = (n: number, z = 2) => ('0' + n).slice(-z);
    return `${hrs}:${pad(mins)}:${pad(secs)}.${pad(centis)}`;
  }

  public static generateAssSubtitleContent(
    transcription: IWordTimestamp[],
    options: AssSubtitleOptions = {}
  ): string {
    const {
      fontName = 'Cabinet Grotesk',
      fontSize = 68,
      alignment = 2,
      marginV = 320,
      resolution = { width: 1080, height: 1920 },
    } = options;

    const header = `[Script Info]
Title: ShortsInShort Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: ${resolution.width}
PlayResY: ${resolution.height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: KaraokeNeon,${fontName},${fontSize},&H00FFFFFF,&H0015CCFA,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,3,${alignment},60,60,${marginV},1
Style: HighlightYellow,${fontName},${fontSize},&H0015FAFC,&H00000000,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,3,${alignment},60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const chunks: IWordTimestamp[][] = [];
    let currentChunk: IWordTimestamp[] = [];

    for (const item of transcription) {
      currentChunk.push(item);
      if (
        currentChunk.length >= 4 ||
        item.word.includes('.') ||
        item.word.includes('!') ||
        item.word.includes('?')
      ) {
        chunks.push(currentChunk);
        currentChunk = [];
      }
    }
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    const events = chunks.map((chunk) => {
      const startSec = chunk[0].startMs / 1000;
      const endSec = chunk[chunk.length - 1].endMs / 1000;

      const textTokens = chunk.map((w) => {
        const durationCentis = Math.max(1, Math.round((w.endMs - w.startMs) / 10));
        const cleanWord = w.word.toUpperCase();
        if (w.highlight) {
          return `{\\c&H0015CCFA&\\b1}${cleanWord}{\\r}`;
        }
        return `{\\k${durationCentis}}${cleanWord}`;
      });

      const lineText = textTokens.join(' ');
      return `Dialogue: 0,${this.formatAssTime(startSec)},${this.formatAssTime(endSec)},KaraokeNeon,,0,0,0,,${lineText}`;
    });

    return header + events.join('\n') + '\n';
  }

  private static buildTransitionFilter(
    transition: TransitionOptions,
    fromLabel: string,
    toLabel: string,
    outputLabel: string,
    videoWidth: number,
    videoHeight: number
  ): string {
    const durationSec = (transition.durationMs || 300) / 1000;
    
    switch (transition.type) {
      case 'fade':
        return `[${fromLabel}][${toLabel}]xfade=transition=fade:duration=${durationSec}:offset=0[${outputLabel}]`;
      
      case 'slide_left':
        return `[${fromLabel}][${toLabel}]xfade=transition=slideleft:duration=${durationSec}:offset=0[${outputLabel}]`;
      
      case 'zoom_in':
        return `[${fromLabel}][${toLabel}]xfade=transition=zoomin:duration=${durationSec}:offset=0[${outputLabel}]`;
      
      case 'wipe':
        return `[${fromLabel}][${toLabel}]xfade=transition=wipeleft:duration=${durationSec}:offset=0[${outputLabel}]`;
      
      case 'cut':
      default:
        return `[${toLabel}]copy[${outputLabel}]`;
    }
  }

  private static buildZoomFilter(
    zoomEffect: ZoomEffectOptions,
    inputLabel: string,
    outputLabel: string,
    videoWidth: number,
    videoHeight: number
  ): string {
    if (zoomEffect.type === 'none') {
      return `[${inputLabel}]copy[${outputLabel}]`;
    }

    const intensity = zoomEffect.intensity || 'subtle';
    const startScale = zoomEffect.startScale || (intensity === 'dynamic' ? 1.0 : 1.05);
    const endScale = zoomEffect.endScale || (intensity === 'dynamic' ? 1.3 : 1.15);
    const durationMs = zoomEffect.durationMs || 3000;

    switch (zoomEffect.type) {
      case 'punch_in':
        return `[${inputLabel}]zoompan=z='min(zoom+0.0015,${endScale})':d=${Math.round(durationMs/33.33)}:s=${videoWidth}x${videoHeight}:fps=30[${outputLabel}]`;
      
      case 'ken_burns':
        return `[${inputLabel}]zoompan=z='min(zoom+0.0005,${endScale})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(durationMs/33.33)}:s=${videoWidth}x${videoHeight}:fps=30[${outputLabel}]`;
      
      case 'slow_zoom':
        return `[${inputLabel}]zoompan=z='min(zoom+0.0003,${endScale})':d=${Math.round(durationMs/33.33)}:s=${videoWidth}x${videoHeight}:fps=30[${outputLabel}]`;
      
      default:
        return `[${inputLabel}]copy[${outputLabel}]`;
    }
  }

  private static buildBrollOverlayFilter(
    broll: BrollOverlayOptions,
    mainLabel: string,
    brollInputIndex: number,
    outputLabel: string,
    videoWidth: number,
    videoHeight: number
  ): { filter: string; needsBrollInput: boolean } {
    const transition = broll.transition || { type: 'fade', durationMs: 300 };
    const opacity = broll.opacity || 1.0;
    const scale = broll.scale || 1.0;
    const startSec = broll.startSec;
    const endSec = broll.endSec;

    const escapedPath = broll.mediaPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    
    let positionFilter = '';
    switch (broll.position) {
      case 'top':
        positionFilter = `:x=(W-w)/2:y=0`;
        break;
      case 'bottom':
        positionFilter = `:x=(W-w)/2:y=H-h`;
        break;
      case 'left':
        positionFilter = `:x=0:y=(H-h)/2`;
        break;
      case 'right':
        positionFilter = `:x=W-w:y=(H-h)/2`;
        break;
      case 'center':
      default:
        positionFilter = `:x=(W-w)/2:y=(H-h)/2`;
        break;
    }

    const filter = `[${brollInputIndex}:v]scale=${Math.round(videoWidth*scale)}:${Math.round(videoHeight*scale)}:force_original_aspect_ratio=decrease[broll_scaled];` +
      `[${mainLabel}][broll_scaled]overlay${positionFilter}:enable='between(t,${startSec},${endSec})':format=auto:alpha=${opacity}[${outputLabel}]`;

    return { filter, needsBrollInput: true };
  }

  private static buildColorCorrectionFilter(
    colorCorrection: ColorCorrectionOptions,
    inputLabel: string,
    outputLabel: string
  ): string {
    const filters: string[] = [];
    let currentLabel = inputLabel;
    let filterIndex = 0;

    if (colorCorrection.brightness !== undefined && colorCorrection.brightness !== 0) {
      const nextLabel = `${outputLabel}_cc${filterIndex++}`;
      filters.push(`[${currentLabel}]eq=brightness=${colorCorrection.brightness}[${nextLabel}]`);
      currentLabel = nextLabel;
    }

    if (colorCorrection.contrast !== undefined && colorCorrection.contrast !== 1) {
      const nextLabel = `${outputLabel}_cc${filterIndex++}`;
      filters.push(`[${currentLabel}]eq=contrast=${colorCorrection.contrast}[${nextLabel}]`);
      currentLabel = nextLabel;
    }

    if (colorCorrection.saturation !== undefined && colorCorrection.saturation !== 1) {
      const nextLabel = `${outputLabel}_cc${filterIndex++}`;
      filters.push(`[${currentLabel}]eq=saturation=${colorCorrection.saturation}[${nextLabel}]`);
      currentLabel = nextLabel;
    }

    if (colorCorrection.gamma !== undefined && colorCorrection.gamma !== 1) {
      const nextLabel = `${outputLabel}_cc${filterIndex++}`;
      filters.push(`[${currentLabel}]eq=gamma=${colorCorrection.gamma}[${nextLabel}]`);
      currentLabel = nextLabel;
    }

    if ((colorCorrection.temperature !== undefined && colorCorrection.temperature !== 0) ||
        (colorCorrection.tint !== undefined && colorCorrection.tint !== 0)) {
      const nextLabel = `${outputLabel}_cc${filterIndex++}`;
      const temp = colorCorrection.temperature || 0;
      const tint = colorCorrection.tint || 0;
      filters.push(`[${currentLabel}]colorbalance=rs=${temp*0.5}:gs=${-tint*0.3}:bs=${-temp*0.5}:rm=${temp*0.3}:gm=${tint*0.2}:bm=${-temp*0.3}:rh=${temp*0.2}:gh=${tint*0.1}:bh=${-temp*0.2}[${nextLabel}]`);
      currentLabel = nextLabel;
    }

    if (colorCorrection.vignette !== undefined && colorCorrection.vignette > 0) {
      const nextLabel = `${outputLabel}_cc${filterIndex++}`;
      filters.push(`[${currentLabel}]vignette=a=${colorCorrection.vignette}[${nextLabel}]`);
      currentLabel = nextLabel;
    }

    if (filters.length === 0) {
      return `[${inputLabel}]copy[${outputLabel}]`;
    }

    filters.push(`[${currentLabel}]copy[${outputLabel}]`);
    return filters.join(';');
  }

  private static buildSoundEffectsFilter(
    soundEffects: SoundEffectOptions[],
    mainAudioLabel: string,
    outputLabel: string,
    baseInputCount: number
  ): { filter: string; inputIndices: number[] } {
    if (!soundEffects || soundEffects.length === 0) {
      return { filter: `[${mainAudioLabel}]anull[${outputLabel}]`, inputIndices: [] };
    }

    const filters: string[] = [];
    const inputIndices: number[] = [];
    let currentAudioLabel = mainAudioLabel;
    let filterIndex = 0;

    soundEffects.forEach((sfx, idx) => {
      const inputIdx = baseInputCount + idx;
      inputIndices.push(inputIdx);
      const volumeDb = 20 * Math.log10(Math.max(0.001, (sfx.volume || 50) / 100));
      const escapedPath = sfx.mediaPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      
      const nextLabel = `${outputLabel}_sfx${filterIndex++}`;
      filters.push(
        `[${inputIdx}:a]volume=${volumeDb}dB,adelay=${Math.round(sfx.startSec * 1000)}|${Math.round(sfx.startSec * 1000)}[sfx${idx}];` +
        `[${currentAudioLabel}][sfx${idx}]amix=inputs=2:duration=first:dropout_transition=100[${nextLabel}]`
      );
      currentAudioLabel = nextLabel;
    });

    filters.push(`[${currentAudioLabel}]anull[${outputLabel}]`);
    return { filter: filters.join(';'), inputIndices };
  }

  private static getTargetResolution(aspectRatio: AspectRatio, resolution: '720p' | '1080p' | '4k' = '1080p'): string {
    const resolutions = {
      '720p': { '9:16': '720:1280', '16:9': '1280:720', '1:1': '720:720', '4:5': '720:900' },
      '1080p': { '9:16': '1080:1920', '16:9': '1920:1080', '1:1': '1080:1080', '4:5': '1080:1350' },
      '4k': { '9:16': '2160:3840', '16:9': '3840:2160', '1:1': '2160:2160', '4:5': '2160:2700' },
    };
    return resolutions[resolution][aspectRatio] || resolutions['1080p'][aspectRatio];
  }

  public static async renderVideo(params: RenderVideoOptions): Promise<{ success: boolean; outputPath: string; thumbnailPath: string }> {
    const { 
      inputPath, 
      outputPath, 
      thumbnailPath, 
      aspectRatio, 
      resolution = '1080p',
      transcription, 
      scenes, 
      audioMix, 
      soundEffects,
      colorCorrection,
      onProgress 
    } = params;
    const ffmpeg = this.getFfmpegPath();

    let assPath: string | null = null;
    if (transcription && transcription.length > 0) {
      assPath = outputPath.replace(/\.mp4$/, '.ass');
      const assContent = this.generateAssSubtitleContent(transcription, {
        resolution: aspectRatio === '9:16' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 },
        alignment: 2,
        marginV: aspectRatio === '9:16' ? 360 : 120,
      });
      await fs.promises.writeFile(assPath, assContent, 'utf-8');
    }

    const targetResolution = this.getTargetResolution(aspectRatio, resolution);
    const [videoWidth, videoHeight] = targetResolution.split(':').map(Number);

    const filterComponents: string[] = [];
    const inputPaths: string[] = [inputPath];
    let currentVideoLabel = '0:v';
    let currentAudioLabel = '0:a';
    let filterIndex = 0;

    filterComponents.push(
      `[${currentVideoLabel}]scale=${targetResolution}:force_original_aspect_ratio=increase,crop=${targetResolution}[v${filterIndex}]`
    );
    currentVideoLabel = `v${filterIndex++}`;

    if (colorCorrection) {
      const ccFilter = this.buildColorCorrectionFilter(colorCorrection, currentVideoLabel, `v${filterIndex}`);
      filterComponents.push(ccFilter);
      currentVideoLabel = `v${filterIndex++}`;
    }

    if (scenes && scenes.length > 0) {
      for (const scene of scenes) {
        if (scene.brollMediaUrl && fs.existsSync(scene.brollMediaUrl)) {
          inputPaths.push(scene.brollMediaUrl);
          const brollInputIdx = inputPaths.length - 1;
          
          const brollOptions: BrollOverlayOptions = {
            mediaPath: scene.brollMediaUrl,
            startSec: scene.startMs / 1000,
            endSec: scene.endMs / 1000,
            transition: scene.transition,
            opacity: 0.95,
            scale: 1.0,
            position: 'center',
          };

          const { filter, needsBrollInput } = this.buildBrollOverlayFilter(
            brollOptions,
            currentVideoLabel,
            brollInputIdx,
            `v${filterIndex}`,
            videoWidth,
            videoHeight
          );
          
          if (needsBrollInput) {
          }
          filterComponents.push(filter);
          currentVideoLabel = `v${filterIndex++}`;
        }

        if (scene.zoomEffect && scene.zoomEffect.type !== 'none') {
          const zoomFilter = this.buildZoomFilter(
            scene.zoomEffect,
            currentVideoLabel,
            `v${filterIndex}`,
            videoWidth,
            videoHeight
          );
          filterComponents.push(zoomFilter);
          currentVideoLabel = `v${filterIndex++}`;
        }
      }
    }

    if (assPath && fs.existsSync(assPath)) {
      const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      filterComponents.push(`[${currentVideoLabel}]subtitles='${escapedAssPath}'[v${filterIndex}]`);
      currentVideoLabel = `v${filterIndex++}`;
    }

    // Build audio filter complex
    const audioFilters: string[] = [];
    let audioInputCount = 1;
    let finalAudioLabel = 'aout';
    let hasAudioMix = false;
    let hasSoundEffects = soundEffects && soundEffects.length > 0;

    // Determine the input audio label (first input's audio)
    const inputAudioLabel = '0:a';

    if (audioMix?.backgroundMusicPath && fs.existsSync(audioMix.backgroundMusicPath)) {
      inputPaths.push(audioMix.backgroundMusicPath);
      const musicInputIdx = inputPaths.length - 1;
      audioInputCount++;
      hasAudioMix = true;
      
      const musicVolumeDb = 20 * Math.log10(Math.max(0.001, (audioMix.musicVolume || 15) / 100));

      if (audioMix.autoDucking !== false) {
        const duckThreshold = audioMix.duckThresholdDb || -20;
        const duckRatio = audioMix.duckRatio || 4;
        const duckAttack = audioMix.duckAttackMs || 10;
        const duckRelease = audioMix.duckReleaseMs || 200;

        // Duck background music under the primary audio (0:a = voice/narration),
        // then mix the primary audio with the ducked music.
        audioFilters.push(
          `[${musicInputIdx}:a]volume=${musicVolumeDb}dB[music];` +
          `[music][${inputAudioLabel}]sidechaincompress=threshold=${duckThreshold}dB:ratio=${duckRatio}:attack=${duckAttack}:release=${duckRelease}[ducked_music];` +
          `[${inputAudioLabel}][ducked_music]amix=inputs=2:duration=first:dropout_transition=3[aout]`
        );
        finalAudioLabel = 'aout';
      } else {
        audioFilters.push(
          `[${musicInputIdx}:a]volume=${musicVolumeDb}dB[music];` +
          `[${inputAudioLabel}][music]amix=inputs=2:duration=first:dropout_transition=3[aout]`
        );
        finalAudioLabel = 'aout';
      }
    }

    if (hasSoundEffects && soundEffects) {
      const { filter, inputIndices } = this.buildSoundEffectsFilter(
        soundEffects,
        hasAudioMix ? 'aout' : inputAudioLabel,
        'aout_final',
        audioInputCount
      );
      audioFilters.push(filter);
      
      soundEffects.forEach(sfx => {
        inputPaths.push(sfx.mediaPath);
      });
      finalAudioLabel = 'aout_final';
    }

    const args = ['-y'];
    
    inputPaths.forEach(p => {
      args.push('-i', p);
    });

    // Combine video and audio filters into single filter_complex
    const allFilters = [...filterComponents, ...audioFilters];
    
    if (allFilters.length > 0) {
      args.push('-filter_complex', allFilters.join(';'));
      args.push('-map', `[${currentVideoLabel}]`);
      if (finalAudioLabel !== 'aout' || hasAudioMix || hasSoundEffects) {
        args.push('-map', `[${finalAudioLabel}]`);
      } else {
        args.push('-map', '0:a?');
      }
    } else {
      args.push('-map', '0:v');
      args.push('-map', '0:a?');
    }

    const crf = resolution === '4k' ? '20' : resolution === '720p' ? '24' : '22';
    const preset = resolution === '4k' ? 'medium' : 'fast';
    
    args.push(
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', crf,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      '-movflags', '+faststart',
      outputPath,
    );

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpeg, args);

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        const timeMatch = /time=(\d+):(\d+):(\d+\.\d+)/.exec(text);
        if (timeMatch && onProgress) {
          const hours = parseInt(timeMatch[1], 10);
          const mins = parseInt(timeMatch[2], 10);
          const secs = parseFloat(timeMatch[3]);
          const currentSec = hours * 3600 + mins * 60 + secs;
          const progressPercent = Math.min(95, Math.max(5, Math.round((currentSec / 45) * 100)));
          onProgress(progressPercent);
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          if (onProgress) onProgress(100);
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with non-zero code ${code}`));
        }
      });

      proc.on('error', (err) => reject(err));
    });

    try {
      await this.generateThumbnails(ffmpeg, outputPath, thumbnailPath, videoWidth, videoHeight);
    } catch (err: any) {
      console.warn('[FFmpeg] Thumbnail generation notice:', err.message);
    }

    return {
      success: true,
      outputPath,
      thumbnailPath,
    };
  }

  private static async generateThumbnails(
    ffmpeg: string,
    videoPath: string,
    outputThumbnailPath: string,
    videoWidth: number,
    videoHeight: number
  ): Promise<void> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const tempDir = path.dirname(outputThumbnailPath);
    const baseName = path.basename(outputThumbnailPath, path.extname(outputThumbnailPath));
    
    const timestamps = ['00:00:01.500', '00:00:03.000', '00:00:05.000', '00:00:08.000', '00:00:10.000'];
    const framePaths = timestamps.map((ts, i) => 
      path.join(tempDir, `${baseName}_thumb${i}.jpg`)
    );

    await Promise.all(
      timestamps.map((ts, i) => 
        execFileAsync(ffmpeg, [
          '-y',
          '-ss', ts,
          '-i', videoPath,
          '-vframes', '1',
          '-q:v', '2',
          '-vf', `scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=decrease`,
          framePaths[i],
        ])
      )
    );

    const mainThumb = framePaths[0];
    if (fs.existsSync(mainThumb)) {
      await fs.promises.copyFile(mainThumb, outputThumbnailPath);
    }

    await Promise.all(
      framePaths.map(p => fs.promises.unlink(p).catch(() => {}))
    );
  }
}