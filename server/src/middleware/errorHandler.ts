import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';
import { config } from '../config/env.js';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void => {
  console.error(`💥 [Unhandled Error] ${req.method} ${req.url}:`, err);

  const statusCode = err.statusCode || (err.name === 'ValidationError' ? 422 : 500);
  const message = err.message || 'Internal server error occurred.';

  sendError(
    res,
    message,
    statusCode,
    config.env === 'development' ? { stack: err.stack, details: err } : undefined
  );
};

