/**
 * Build-time preparation for Motion Explainer renders (used by the Docker image):
 *   npm run motion:prepare -- <outDir> [--no-browser]
 * 1. Bundles the Remotion compositions into <outDir> (point MOTION_BUNDLE_DIR at it), so the first
 *    render doesn't spend ~20 s in webpack and production never needs the web app's source.
 * 2. Downloads Remotion's headless Chrome now instead of on the first render.
 */
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser } from '@remotion/renderer';
import { MOTION_ENTRY } from '../services/video/motionRender.js';

const args = process.argv.slice(2);
const outDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'motion-bundle');
const t0 = Date.now();
await bundle({ entryPoint: MOTION_ENTRY, outDir });
console.log(`Bundled ${MOTION_ENTRY} -> ${outDir} in ${Date.now() - t0} ms`);
if (!args.includes('--no-browser')) {
  await ensureBrowser();
  console.log('Headless Chrome ready');
}
