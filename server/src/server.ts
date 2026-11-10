import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { Worker } from './services/queue/worker.js';
import { registerRenderJob } from './services/video/renderJob.js';
import { registerNarrationJob } from './services/audio/narrationJob.js';
import { registerCloneJob } from './services/voice/cloneJob.js';
import { registerPlanScenesJob } from './services/faceless/planJob.js';

async function main() {
  // Fail fast: the API never serves traffic without its database.
  await connectDB(env.mongodbUri);
  const server = createApp().listen(env.port, () => {
    logger.info(
      { port: env.port, env: env.nodeEnv, email: env.smtp ? 'smtp' : 'dev-log', google: Boolean(env.google), storage: env.storage.driver, worker: env.video.workerMode },
      `ShortsInShort API listening on http://localhost:${env.port}`,
    );
  });

  // In development the API also processes jobs; in production run `npm run worker` separately
  // so rendering load never competes with API requests.
  let worker: Worker | null = null;
  if (env.video.workerMode === 'embedded') {
    registerRenderJob();
    registerNarrationJob();
    registerCloneJob();
    registerPlanScenesJob();
    worker = new Worker();
    worker.start();
  }

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await worker?.stop();
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
