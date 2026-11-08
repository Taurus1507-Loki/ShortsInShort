import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { env } from '../../config/env.js';

const require = createRequire(import.meta.url);

/** Binary resolution: explicit env path (production images use distro FFmpeg) → bundled npm binary. */
export const FFMPEG = env.video.ffmpegPath ?? (require('ffmpeg-static') as string);
export const FFPROBE = env.video.ffprobePath ?? (require('@ffprobe-installer/ffprobe') as { path: string }).path;

export class FfmpegError extends Error {
  constructor(
    message: string,
    public readonly stderrTail: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'FfmpegError';
  }
}

export interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Called with output time (seconds) parsed from `-progress pipe:1`. */
  onProgress?: (outTimeSec: number) => void;
}

/** Spawns a binary without a shell (no injection surface) and collects stderr. */
function run(bin: string, args: string[], opts: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve({ stdout, stderr });
    };
    const kill = (why: string) => {
      child.kill('SIGKILL');
      finish(new FfmpegError(why, stderr.slice(-2000), null));
    };
    const onAbort = () => kill('Processing was cancelled.');
    const timer = opts.timeoutMs ? setTimeout(() => kill('Processing timed out.'), opts.timeoutMs) : undefined;
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      if (opts.onProgress) {
        for (const m of s.matchAll(/out_time_us=(\d+)/g)) opts.onProgress(Number(m[1]) / 1e6);
      } else {
        stdout += s;
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000); // bound memory
    });
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (code === 0) finish(null);
      else finish(new FfmpegError(`${bin.includes('probe') ? 'ffprobe' : 'ffmpeg'} exited with code ${code}`, stderr.slice(-2000), code));
    });
  });
}

export const runFfmpeg = (args: string[], opts?: RunOptions) => run(FFMPEG, ['-hide_banner', '-nostdin', '-y', ...args], opts);

export interface ProbeResult {
  durationSec: number;
  formatName: string;
  video: { width: number; height: number; codec: string; fps: number; rotation: number } | null;
  audio: { codec: string; sampleRate: number; channels: number } | null;
}

export async function probe(input: string, opts: RunOptions = {}): Promise<ProbeResult> {
  const { stdout } = await run(
    FFPROBE,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input],
    { timeoutMs: 60_000, ...opts },
  );
  const data = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string };
    streams?: Array<{
      codec_type: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      sample_rate?: string;
      channels?: number;
      duration?: string;
      tags?: { rotate?: string };
      side_data_list?: Array<{ rotation?: number }>;
    }>;
  };
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && s.width && s.height);
  const a = streams.find((s) => s.codec_type === 'audio');
  const fps = (rate?: string) => {
    const [n, d] = (rate ?? '0/1').split('/').map(Number);
    return d ? n! / d : 0;
  };
  const rotation = Number(v?.tags?.rotate ?? v?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  return {
    durationSec: Number(data.format?.duration ?? v?.duration ?? 0),
    formatName: data.format?.format_name ?? '',
    video: v
      ? {
          // Report display dimensions (phones record rotated portrait video).
          width: rotated ? v.height! : v.width!,
          height: rotated ? v.width! : v.height!,
          codec: v.codec_name ?? '',
          fps: fps(v.avg_frame_rate) || fps(v.r_frame_rate),
          rotation,
        }
      : null,
    audio: a ? { codec: a.codec_name ?? '', sampleRate: Number(a.sample_rate ?? 0), channels: a.channels ?? 0 } : null,
  };
}
