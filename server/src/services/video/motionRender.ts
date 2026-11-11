import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { MotionScene } from '../faceless/motion.js';

export const MOTION_FPS = 30;

export interface MotionTheme {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  muted: string;
}

export interface MotionRenderInput {
  scenes: Array<MotionScene & { durationInFrames: number }>;
  theme: MotionTheme;
  width: number;
  height: number;
  output: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/** Renders the Motion Explainer composition to a silent MP4. Swappable for tests. */
export type MotionRenderer = (input: MotionRenderInput) => Promise<void>;

const here = path.dirname(fileURLToPath(import.meta.url));
/** The compositions live with the web app (they also power its live preview). */
export const MOTION_ENTRY = env.motion.entry ?? path.resolve(here, '../../../../client/src/motion/entry.tsx');

let bundled: Promise<string> | null = null;

/** Bundles the compositions once per process (webpack, ~10–20 s) and reuses the result. */
function serveUrl(): Promise<string> {
  if (env.motion.bundleDir) return Promise.resolve(env.motion.bundleDir);
  bundled ??= (async () => {
    const { bundle } = await import('@remotion/bundler');
    const t0 = Date.now();
    const url = await bundle({ entryPoint: MOTION_ENTRY });
    logger.info({ ms: Date.now() - t0 }, 'Motion compositions bundled');
    return url;
  })().catch((err) => {
    bundled = null;
    throw err;
  });
  return bundled;
}

/** Remotion server-side render in headless Chrome (downloaded by Remotion on first use). */
export const remotionRenderer: MotionRenderer = async (input) => {
  const { renderMedia, selectComposition, makeCancelSignal } = await import('@remotion/renderer');
  const url = await serveUrl();
  const inputProps = { scenes: input.scenes, theme: input.theme, width: input.width, height: input.height };
  const composition = await selectComposition({ serveUrl: url, id: 'MotionVideo', inputProps });
  const { cancelSignal, cancel } = makeCancelSignal();
  const onAbort = () => cancel();
  input.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await renderMedia({
      composition,
      serveUrl: url,
      inputProps,
      codec: 'h264',
      outputLocation: input.output,
      muted: true,
      crf: 18,
      concurrency: env.motion.concurrency ?? null,
      cancelSignal,
      onProgress: ({ progress }) => input.onProgress?.(progress),
    });
  } finally {
    input.signal?.removeEventListener('abort', onAbort);
  }
};

let override: MotionRenderer | undefined;
/** Test seam: replace the renderer (undefined = real Remotion). */
export function setMotionRenderer(r: MotionRenderer | undefined) {
  override = r;
}
export const getMotionRenderer = (): MotionRenderer => override ?? remotionRenderer;

const mix = (hex: string, toward: string, t: number) => {
  const a = hex.match(/[0-9a-f]{2}/gi)!.map((x) => parseInt(x, 16));
  const b = toward.match(/[0-9a-f]{2}/gi)!.map((x) => parseInt(x, 16));
  return `#${a.map((v, i) => Math.round(v + (b[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

/** Dark explainer theme from the Brand Kit colours (accents keep the brand; the base stays readable). */
export function motionTheme(primary = '#7C3AED', secondary = '#22D3EE'): MotionTheme {
  const ok = (c: string, d: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : d);
  const p = ok(primary, '#7C3AED');
  return { primary: p, secondary: ok(secondary, '#22D3EE'), background: mix(p, '#05050A', 0.9), text: '#FFFFFF', muted: '#A1A1AA' };
}
