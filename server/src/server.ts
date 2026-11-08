import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';

async function main() {
  // Fail fast: the API never serves traffic without its database.
  await connectDB(env.mongodbUri);
  const server = createApp().listen(env.port, () => {
    logger.info(
      { port: env.port, env: env.nodeEnv, email: env.smtp ? 'smtp' : 'dev-log', google: Boolean(env.google) },
      `ShortsInShort API listening on http://localhost:${env.port}`,
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
