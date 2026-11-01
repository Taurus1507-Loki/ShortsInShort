import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { config } from './config/env.js';

const startServer = async () => {
  try {
    console.log('⚡ Starting ShortsInShort API Server...');
    await connectDB();

    const app = createApp();

    const server = app.listen(config.port, () => {
      console.log(`🚀 ShortsInShort Backend running on http://localhost:${config.port}`);
      console.log(`🌐 Environment: ${config.env}`);
    });

    // Graceful Shutdown
    const signals = ['SIGINT', 'SIGTERM'] as const;
    signals.forEach((signal) => {
      process.on(signal, () => {
        console.log(`\n🛑 Received ${signal}, closing server gracefully...`);
        server.close(() => {
          console.log('💤 HTTP server closed.');
          process.exit(0);
        });
      });
    });
  } catch (error) {
    console.error('💥 Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

