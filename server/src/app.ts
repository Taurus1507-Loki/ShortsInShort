import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import path from 'path';
import { config } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import creditRoutes from './routes/creditRoutes.js';
import templateRoutes from './routes/templateRoutes.js';
import videoRoutes from './routes/videoRoutes.js';
import healthRoutes from './routes/healthRoutes.js';

export const createApp = () => {
  const app = express();

  // Security & HTTP Headers
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // CORS Configuration
  app.use(
    cors({
      origin: [config.clientUrl, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    })
  );

  // Request Parsers
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use(cookieParser());

  // Static File Serving for Media Uploads, Processed Videos & Thumbnails
  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

  // Logging (in non-test environments)
  if (config.env !== 'test') {
    app.use(morgan('dev'));
  }

  // API Routes
  app.use('/api', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/credits', creditRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/videos', videoRoutes);

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
};
