import express, { Router } from 'express';
import { z } from 'zod';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, badRequest, notFound } from '../../utils/errors.js';
import { audit } from '../../services/audit.service.js';
import { MOODS } from '../../services/ai/music.js';
import { importTrack, listTracks, MAX_TRACK_BYTES, MusicImportError, PIXABAY_LICENSE, PIXABAY_LICENSE_URL, removeTrack, trackPath, updateTrack } from '../../services/ai/musicLibrary.js';

/**
 * Admin: the licensed background-music library. Admins add Pixabay Music tracks they downloaded
 * (Pixabay has no music API); each is checked, loudness-normalised and tagged with moods.
 * Mounted under the admin router, so every route already requires an admin role.
 */
export const musicAdminRouter = Router();

const fileParams = z.object({ file: z.string().regex(/^[a-z0-9-]+\.mp3$/, 'Invalid track') });
const moods = z.array(z.enum(MOODS)).min(1, 'Pick at least one mood.').max(5);

musicAdminRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ data: { tracks: await listTracks(), moods: MOODS, license: { name: PIXABAY_LICENSE, url: PIXABAY_LICENSE_URL } } });
  }),
);

/** Upload one track as the raw request body (?name=original-file-name.mp3). */
musicAdminRouter.post(
  '/',
  express.raw({ type: () => true, limit: MAX_TRACK_BYTES }),
  asyncHandler(async (req, res) => {
    const name = String(req.query.name ?? '').slice(0, 200);
    if (!name) throw badRequest('Missing the file name.', 'NO_NAME');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Choose an audio file to upload.', 'NO_FILE');
    const dir = await mkdtemp(path.join(tmpdir(), 'sis-music-'));
    try {
      const src = path.join(dir, 'upload');
      await writeFile(src, body);
      const { entry, duplicate } = await importTrack(src, name);
      if (!duplicate) await audit(req, 'admin.music_added', { actorId: req.auth!.user._id, metadata: { file: entry.file, title: entry.title, artist: entry.artist, moods: entry.moods } });
      res.status(duplicate ? 200 : 201).json({ data: { track: entry, duplicate } });
    } catch (err) {
      if (err instanceof MusicImportError) throw badRequest(err.message, 'INVALID_TRACK');
      throw err;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }),
);

musicAdminRouter.patch(
  '/:file',
  validate({ params: fileParams, body: z.object({ moods: moods.optional(), title: z.string().trim().min(1).max(80).optional(), artist: z.string().trim().min(1).max(80).optional() }).strict() }),
  asyncHandler(async (req, res) => {
    const track = await updateTrack(req.params.file!, req.body);
    if (!track) throw notFound('Track not found.');
    await audit(req, 'admin.music_updated', { actorId: req.auth!.user._id, metadata: { file: track.file, ...req.body } });
    res.json({ data: track });
  }),
);

musicAdminRouter.delete(
  '/:file',
  validate({ params: fileParams }),
  asyncHandler(async (req, res) => {
    if (!(await removeTrack(req.params.file!))) throw notFound('Track not found.');
    await audit(req, 'admin.music_removed', { actorId: req.auth!.user._id, metadata: { file: req.params.file } });
    res.status(204).end();
  }),
);

/** Streams a track for the admin preview player. */
musicAdminRouter.get(
  '/:file/audio',
  validate({ params: fileParams }),
  asyncHandler(async (req, res) => {
    const full = trackPath(req.params.file!);
    if (!full) throw notFound('Track not found.');
    res.type('audio/mpeg').sendFile(full);
  }),
);
