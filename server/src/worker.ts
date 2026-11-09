/** Standalone worker process: `npm run worker`. Scale horizontally by running more of these. */
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDB, disconnectDB } from './config/db.js';
import { Worker } from './services/queue/worker.js';
import { registerRenderJob } from './services/video/renderJob.js';
import { registerNarrationJob } from './services/audio/narrationJob.js';

async function main() {
  await connectDB(env.mongodbUri);
  registerRenderJob();
  registerNarrationJob();
  const worker = new Worker();
  worker.start();
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Worker shutting down');
    await worker.stop();
    await disconnectDB();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
