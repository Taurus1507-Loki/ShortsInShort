import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { env } from '../config/env.js';
import { runFfmpeg, probe } from '../services/video/ffmpeg.js';
import { loadLibrary, pickTrack } from '../services/ai/music.js';
import { guessMoods, looksLikeAudio, parseTrackName } from '../services/ai/musicLibrary.js';

let tones = '';
let longTone: Buffer;
let shortTone: Buffer;

beforeAll(async () => {
  await connectTestDb();
  tones = await mkdtemp(path.join(tmpdir(), 'sis-music-src-'));
  // A quiet 12 s tone (real MP3) and a 4 s one (too short to be a music track).
  await runFfmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.05*sin(2*PI*440*t)':s=44100:d=12", '-c:a', 'libmp3lame', '-b:a', '128k', path.join(tones, 'long.mp3')]);
  await runFfmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*440*t)':s=44100:d=4", '-c:a', 'libmp3lame', '-b:a', '128k', path.join(tones, 'short.mp3')]);
  longTone = await readFile(path.join(tones, 'long.mp3'));
  shortTone = await readFile(path.join(tones, 'short.mp3'));
}, 60_000);
beforeEach(async () => {
  await resetDb();
  // Each test starts with an empty library.
  for (const f of await readdir(env.music.libraryDir).catch(() => [] as string[])) await rm(path.join(env.music.libraryDir, f), { force: true });
});
afterAll(async () => {
  await rm(tones, { recursive: true, force: true });
  await mongoose.disconnect();
});

async function admin() {
  const u = await registerUser({ verify: true, name: 'Admin Amy' });
  await User.updateOne({ _id: u.user.id }, { role: 'admin' });
  return u;
}
const upload = (auth: Record<string, string>, name: string, body: Buffer) =>
  request(app).post(`/api/admin/music?name=${encodeURIComponent(name)}`).set(auth).set('Content-Type', 'audio/mpeg').send(body);

describe('music library helpers', () => {
  it('reads title and artist from Pixabay download names', () => {
    expect(parseTrackName('alexgrohl-sad-soul-chasing-a-feeling-185750.mp3')).toEqual({ artist: 'Alexgrohl', title: 'Sad Soul Chasing A Feeling' });
    expect(parseTrackName('the_mountain-calm-piano-12345.mp3')).toEqual({ artist: 'The Mountain', title: 'Calm Piano' });
    expect(parseTrackName('track.mp3').title).toBe('Track');
  });

  it('guesses moods from the name, defaulting to upbeat', () => {
    expect(guessMoods('Calm Piano Ambient')).toEqual(expect.arrayContaining(['calm']));
    expect(guessMoods('Epic Cinematic Trailer')).toEqual(['cinematic']);
    expect(guessMoods('Lofi Hip Hop Study Beat')).toContain('lofi');
    expect(guessMoods('Corporate Motivational Background')).toContain('corporate');
    expect(guessMoods('Track 7')).toEqual(['upbeat']);
  });

  it('recognises real audio by its first bytes', () => {
    expect(looksLikeAudio(longTone.subarray(0, 16))).toBe(true);
    expect(looksLikeAudio(Buffer.from('<html><body>not audio</body>'))).toBe(false);
  });
});

describe('admin music library', () => {
  it('is for admins only', async () => {
    const customer = await registerUser({ verify: true });
    await request(app).get('/api/admin/music').expect(401);
    await request(app).get('/api/admin/music').set(customer.auth).expect(403);
    await upload(customer.auth, 'x.mp3', longTone).expect(403);
  });

  it('imports a Pixabay track: normalised, mood-tagged, licensed, used by renders, and never twice', async () => {
    const { auth, user } = await admin();
    expect((await request(app).get('/api/meta').expect(200)).body.data.features.music).toBe(false);

    const res = await upload(auth, 'chillmusic-calm-piano-morning-123456.mp3', longTone).expect(201);
    const track = res.body.data.track;
    expect(track).toMatchObject({ title: 'Calm Piano Morning', artist: 'Chillmusic', license: 'Pixabay Content License', source: 'pixabay' });
    expect(track.moods).toContain('calm');
    expect(track.durationSec).toBeCloseTo(12, 0);

    // Converted to a normalised MP3 in the library, and picked up by the renderer.
    const out = await probe(path.join(env.music.libraryDir, track.file));
    expect(out.audio).toBeTruthy();
    const lib = loadLibrary();
    expect(lib).toHaveLength(1);
    expect(pickTrack(lib, 'calm', 'viral', 'project-1')?.file).toBe(track.file);
    expect((await request(app).get('/api/meta').expect(200)).body.data.features.music).toBe(true);

    // Uploading the same file again changes nothing.
    const again = await upload(auth, 'renamed.mp3', longTone).expect(200);
    expect(again.body.data).toMatchObject({ duplicate: true, track: { file: track.file } });
    expect(loadLibrary()).toHaveLength(1);
    expect(await AuditLog.countDocuments({ action: 'admin.music_added', actorId: user.id })).toBe(1);
  }, 60_000);

  it('refuses files that are not audio or too short', async () => {
    const { auth } = await admin();
    expect((await upload(auth, 'evil.mp3', Buffer.from('<?php echo "nope"; ?> padding padding')).expect(400)).body.error.code).toBe('INVALID_TRACK');
    expect((await upload(auth, 'short.mp3', shortTone).expect(400)).body.error.message).toMatch(/at least 10 seconds/);
    await request(app).post('/api/admin/music').set(auth).set('Content-Type', 'audio/mpeg').send(longTone).expect(400); // no name
    expect(loadLibrary()).toHaveLength(0);
  }, 60_000);

  it('re-tags, previews and removes tracks', async () => {
    const { auth } = await admin();
    const { file } = (await upload(auth, 'beats-track-one-1111.mp3', longTone).expect(201)).body.data.track;

    const tagged = await request(app).patch(`/api/admin/music/${file}`).set(auth).send({ moods: ['cinematic', 'corporate'] }).expect(200);
    expect(tagged.body.data.moods).toEqual(['cinematic', 'corporate']);
    await request(app).patch(`/api/admin/music/${file}`).set(auth).send({ moods: [] }).expect(400);
    await request(app).patch(`/api/admin/music/${file}`).set(auth).send({ moods: ['disco'] }).expect(400);
    expect(loadLibrary()[0]!.moods).toEqual(['cinematic', 'corporate']);

    const audio = await request(app).get(`/api/admin/music/${file}/audio`).set(auth).expect(200);
    expect(audio.headers['content-type']).toMatch(/audio\/mpeg/);
    await request(app).get('/api/admin/music/..%2F..%2Fmusic.json/audio').set(auth).expect(400);

    const list = (await request(app).get('/api/admin/music').set(auth).expect(200)).body.data;
    expect(list.tracks[0]).toMatchObject({ file, usable: true });
    expect(list.moods).toEqual(['upbeat', 'calm', 'cinematic', 'corporate', 'lofi']);

    await request(app).delete(`/api/admin/music/${file}`).set(auth).expect(204);
    expect(loadLibrary()).toHaveLength(0);
    expect(await readdir(env.music.libraryDir)).not.toContain(file);
    await request(app).delete(`/api/admin/music/${file}`).set(auth).expect(404);
  }, 60_000);
});
