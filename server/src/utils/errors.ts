import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthorized = (message = 'Authentication required.', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);
export const forbidden = (message = 'You do not have permission to do that.', code = 'FORBIDDEN') =>
  new AppError(403, code, message);
export const notFound = (message = 'Not found.', code = 'NOT_FOUND') => new AppError(404, code, message);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);
export const notConfigured = (feature: string) =>
  new AppError(503, 'NOT_CONFIGURED', `${feature} is not configured on this server.`);

/** Wraps an async route handler so rejected promises reach the error middleware. */
export const asyncHandler =
  <P = Record<string, string>>(fn: (req: Request<P>, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler<P> =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
