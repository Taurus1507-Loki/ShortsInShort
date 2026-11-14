import { Router, type Request } from 'express';
import { asyncHandler, AppError, forbidden, notFound } from '../../utils/errors.js';
import { localStorage, verifyLocalSignature } from '../../services/storage/storage.js';

/**
 * Serves the LOCAL storage driver through signed, expiring URLs (the same capability model as S3
 * presigned URLs). Only mounted when STORAGE_DRIVER=local.
 */
export const storageRouter = Router();

function verify(req: Request, op: 'get' | 'put') {
  const key = req.params[0] as string;
  const exp = Number(req.query.exp);
  const max = Number(req.query.max ?? 0);
  const name = typeof req.query.name === 'string' ? req.query.name : '';
  const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
  if (!key || !sig || !verifyLocalSignature(op, key, exp, max, name, sig)) throw forbidden('This link is invalid or has expired.', 'BAD_SIGNATURE');
  return { key, max, name };
}

storageRouter.get(
  '/get/*',
  asyncHandler(async (req, res) => {
    const { key, name } = verify(req, 'get');
    const s = await localStorage.stat(key);
    if (!s) throw notFound('File not found.');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (name) res.attachment(name);
    // sendFile handles Range requests, so <video> can seek and stream.
    res.sendFile(localStorage.resolve(key), { dotfiles: 'deny' });
  }),
);

storageRouter.put(
  '/put/*',
  asyncHandler(async (req, res) => {
    const { key, max } = verify(req, 'put');
    const declared = Number(req.get('content-length') ?? 0);
    if (declared && declared > max) throw new AppError(413, 'TOO_LARGE', 'File exceeds the allowed size.');
    try {
      const bytes = await localStorage.writeStream(key, req, max);
      res.status(200).json({ data: { bytes } });
    } catch (err) {
      if ((err as { code?: string }).code === 'TOO_LARGE') throw new AppError(413, 'TOO_LARGE', 'File exceeds the allowed size.');
      if ((err as { code?: string }).code === 'ALREADY_EXISTS') throw new AppError(409, 'ALREADY_UPLOADED', 'This file has already been uploaded. Start a new upload instead.');
      throw err;
    }
  }),
);
