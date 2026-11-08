import { Config } from '@remotion/cli/config';
import { enableTailwind } from '@remotion/tailwind';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

enableTailwind({
  configPath: path.resolve(__dirname, '..', 'tailwind.config.js'),
} as any);

Config.setVideoImageFormat('png');
Config.setPixelFormat('yuv420p');