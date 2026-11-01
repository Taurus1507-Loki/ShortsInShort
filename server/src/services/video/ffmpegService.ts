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
  primaryColor?: string; // ASS hex &HAABBGGRR
  highlightColor?: string; // ASS hex &HAABBGGRR
  alignment?: number; // 2 = bottom center, 5 = middle center, 8 = top center
  marginV?: number;
  resolution?: { width: number; height: number };
}

export class FFmpegService {
  public static getFfmpegPath(): string {
    return process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string) || 'ffmpeg';
  }

  public static getFfprobePath(): string {
    return process.env.FFPROBE_PATH || ffprobeInstaller.path || 'ffprobe';
  }

  /**
   * Retrieves container and stream metadata using ffprobe
   */
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
      // Fallback sensible defaults for vertical short
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

  /**
   * Detects pauses and dead air using FFmpeg silencedetect filter
   */
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

  /**
   * Inverts silence intervals to compute active speech cut segments
   */
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

  /**
   * Helper to convert seconds to ASS time format: H:MM:SS.cc
   */
  public static formatAssTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const centis = Math.floor((seconds % 1) * 100);

    const pad = (n: number, z = 2) => ('0' + n).slice(-z);
    return `${hrs}:${pad(mins)}:${pad(secs)}.${pad(centis)}`;
  }

  /**
   * Generates a Submagic-style ASS subtitle file with animated karaoke highlights
   */
  public static generateAssSubtitleContent(
    transcription: IWordTimestamp[],
    options: AssSubtitleOptions = {}
  ): string {
    const {
      fontName = 'Cabinet Grotesk',
      fontSize = 68,
      alignment = 2, // Bottom-center (or 5 for middle)
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

    // Group words into short punchy caption chunks (3-5 words per screen)
    const chunks: IWordTimestamp[][] = [];
    let currentChunk: IWordTimestamp[] = [];

    for (const item of transcription) {
      currentChunk.push(item);
      // Split on punctuation or max 4 words for fast viral reading
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

      // Build animated karaoke sequence
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

  /**
   * Complete video rendering pipeline with trimming, subtitles, and aspect ratio conversion
   */
  public static async renderVideo(params: {
    inputPath: string;
    outputPath: string;
    thumbnailPath: string;
    aspectRatio: AspectRatio;
    transcription?: IWordTimestamp[];
    brollSegments?: Array<{ startSec: number; endSec: number; mediaUrl?: string }>;
    onProgress?: (progress: number) => void;
  }): Promise<{ success: boolean; outputPath: string; thumbnailPath: string }> {
    const { inputPath, outputPath, thumbnailPath, aspectRatio, transcription, onProgress } = params;
    const ffmpeg = this.getFfmpegPath();

    // 1. Generate ASS subtitle file if transcription exists
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

    // 2. Build video filter graph based on target format
    let targetResolution = '1080:1920';
    if (aspectRatio === '16:9') targetResolution = '1920:1080';
    if (aspectRatio === '1:1') targetResolution = '1080:1080';
    if (aspectRatio === '4:5') targetResolution = '1080:1350';

    const filterComponents: string[] = [
      // Scale and crop to fit aspect ratio exactly without distortion
      `scale=${targetResolution}:force_original_aspect_ratio=increase,crop=${targetResolution}`,
    ];

    // Overlay subtitles if ASS file was created
    if (assPath && fs.existsSync(assPath)) {
      // Escape Windows backslashes for FFmpeg filter argument
      const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      filterComponents.push(`subtitles='${escapedAssPath}'`);
    }

    const videoFilter = filterComponents.join(',');

    const args = [
      '-y',
      '-i', inputPath,
      '-vf', videoFilter,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '22',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      outputPath,
    ];

    // Execute render
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpeg, args);

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        // Extract time=HH:MM:SS.xx to estimate progress
        const timeMatch = /time=(\d+):(\d+):(\d+\.\d+)/.exec(text);
        if (timeMatch && onProgress) {
          const hours = parseInt(timeMatch[1], 10);
          const mins = parseInt(timeMatch[2], 10);
          const secs = parseFloat(timeMatch[3]);
          const currentSec = hours * 3600 + mins * 60 + secs;
          // Approximate progress out of 60 seconds
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

    // 3. Generate high-quality thumbnail image snapshot at 1.5 seconds
    try {
      const thumbArgs = [
        '-y',
        '-ss', '00:00:01.500',
        '-i', outputPath,
        '-vframes', '1',
        '-q:v', '2',
        thumbnailPath,
      ];
      await execFileAsync(ffmpeg, thumbArgs);
    } catch (err: any) {
      console.warn('[FFmpeg] Thumbnail snapshot notice:', err.message);
    }

    return {
      success: true,
      outputPath,
      thumbnailPath,
    };
  }
}
