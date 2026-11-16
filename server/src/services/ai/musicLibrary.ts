import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { probe, runFfmpeg } from '../video/ffmpeg.js';
import { MOODS } from './music.js';

/**
 * Managing the licensed music library (the folder + music.json that services/ai/music.ts reads).
 * Tracks come from Pixabay Music, downloaded by an admin: Pixabay's API has no music endpoint, and its
 * terms forbid scraping. Each import is checked, loudness-normalised and tagged with moods.
 */
export const PIXABAY_LICENSE = 'Pixabay Content License';
export const PIXABAY_LICENSE_URL = 'https://pixabay.com/service/license-summary/';
export const MAX_TRACK_BYTES = 40 * 1024 * 1024;

export interface ManifestEntry {
  file: string;
  title: string;
  artist: string;
  moods: string[];
  license: string;
  licenseUrl?: string;
  durationSec?: number;
  sha1?: string;
  source?: string;
  addedAt?: string;
}

const dirOf = () => env.music.libraryDir;
const manifestPath = (dir: string) => path.join(dir, 'music.json');

export async function readManifest(dir = dirOf()): Promise<ManifestEntry[]> {
  try {
    const raw = JSON.parse(await readFile(manifestPath(dir), 'utf8'));
    return Array.isArray(raw) ? (raw as ManifestEntry[]) : [];
  } catch {
    return [];
  }
}

// One writer at a time (uploads can arrive in parallel); the file is replaced atomically.
let queue: Promise<unknown> = Promise.resolve();
function withManifest<T>(fn: (entries: ManifestEntry[]) => Promise<{ entries: ManifestEntry[]; result: T }>, dir = dirOf()): Promise<T> {
  const next = queue.then(async () => {
    await mkdir(dir, { recursive: true });
    const { entries, result } = await fn(await readManifest(dir));
    const tmp = `${manifestPath(dir)}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    await rename(tmp, manifestPath(dir));
    return result;
  });
  queue = next.catch(() => undefined);
  return next;
}

const titleCase = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/**
 * Title and artist from a Pixabay download name: "artist-name-track-title-123456.mp3" (the numeric id
 * is dropped). Pixabay uses the uploader's handle first; underscores inside it become spaces.
 */
export function parseTrackName(fileName: string): { title: string; artist: string } {
  const base = path.basename(fileName).replace(/\.[a-z0-9]+$/i, '').replace(/[-_ ]\d{3,}$/, '');
  const parts = base.split('-').filter(Boolean);
  if (parts.length < 2) return { title: titleCase(base.replace(/[_-]+/g, ' ')) || 'Untitled', artist: 'Pixabay' };
  return { artist: titleCase(parts[0]!.replace(/_/g, ' ')), title: titleCase(parts.slice(1).join(' ').replace(/_/g, ' ')) };
}

const MOOD_WORDS: Array<[(typeof MOODS)[number], RegExp]> = [
  ['upbeat', /upbeat|happy|energ|fun|pop|funk|dance|summer|positive|uplift|groove|party|sport|rock|electro|edm|bright/i],
  ['calm', /calm|relax|ambient|soft|peace|gentle|piano|acoustic|meditat|sleep|dream|nature|chill|serene|morning/i],
  ['cinematic', /cinematic|epic|dramatic|trailer|orchestra|emotional|inspir|heroic|adventure|dark|suspense|documentary|film/i],
  ['corporate', /corporate|business|motivat|presentation|tech|success|advert|commercial|innovation|startup|background/i],
  ['lofi', /lo-?fi|lofi|hip.?hop|beat|jazz|chillhop|study|coffee|vlog/i],
];

/** Moods from the title/file name; "upbeat" when nothing matches (admins can change it). */
export function guessMoods(text: string): string[] {
  const found = MOOD_WORDS.filter(([, re]) => re.test(text)).map(([m]) => m);
  return found.length ? [...new Set(found)].slice(0, 3) : ['upbeat'];
}

/** First bytes of an MP3, M4A/AAC, WAV or OGG file (anything else is refused before FFmpeg sees it). */
export function looksLikeAudio(head: Buffer): boolean {
  if (head.length < 12) return false;
  if (head.subarray(0, 3).toString('latin1') === 'ID3') return true; // MP3 with ID3 tag
  if (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) return true; // MPEG audio frame / ADTS AAC
  if (head.subarray(4, 8).toString('latin1') === 'ftyp') return true; // M4A
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WAVE') return true;
  if (head.subarray(0, 4).toString('latin1') === 'OggS') return true;
  return false;
}

export class MusicImportError extends Error {}

/**
 * Imports one track: checks it's real audio of a usable length, converts it to a loudness-normalised
 * 192 kbps MP3 (so every track sits at the same level under the voice), and adds it to the manifest.
 * Re-importing the same file is a no-op.
 */
export async function importTrack(src: string, originalName: string, opts: { moods?: string[]; dir?: string } = {}): Promise<{ entry: ManifestEntry; duplicate: boolean }> {
  const dir = opts.dir ?? dirOf();
  const bytes = await readFile(src);
  if (bytes.length > MAX_TRACK_BYTES) throw new MusicImportError('That file is too big (max 40 MB).');
  if (!looksLikeAudio(bytes.subarray(0, 16))) throw new MusicImportError('That file isn’t an audio file (MP3, M4A, WAV or OGG).');
  const sha1 = createHash('sha1').update(bytes).digest('hex');
  const existing = (await readManifest(dir)).find((e) => e.sha1 === sha1);
  if (existing) return { entry: existing, duplicate: true };

  const info = await probe(src);
  if (!info.audio) throw new MusicImportError('No audio found in that file.');
  if (info.durationSec < 10) throw new MusicImportError('Tracks need to be at least 10 seconds long.');
  if (info.durationSec > 15 * 60) throw new MusicImportError('Tracks can be up to 15 minutes long.');

  const { title, artist } = parseTrackName(originalName);
  const slug = `${title}`.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'track';
  const file = `${slug}-${sha1.slice(0, 8)}.mp3`;
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, file);
  const tmp = `${out}.part.mp3`;
  try {
    await runFfmpeg(['-i', src, '-vn', '-map', '0:a:0', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', tmp], {
      timeoutMs: 5 * 60_000,
    });
    await rename(tmp, out);
  } catch (err) {
    await rm(tmp, { force: true });
    throw new MusicImportError(`Could not convert that file: ${(err as Error).message.slice(0, 200)}`);
  }
  const moods = (opts.moods?.length ? opts.moods : guessMoods(`${originalName} ${title}`)).filter((m) => (MOODS as readonly string[]).includes(m));
  const entry: ManifestEntry = {
    file,
    title,
    artist,
    moods: moods.length ? moods : ['upbeat'],
    license: PIXABAY_LICENSE,
    licenseUrl: PIXABAY_LICENSE_URL,
    durationSec: Math.round(info.durationSec * 10) / 10,
    sha1,
    source: 'pixabay',
    addedAt: new Date().toISOString(),
  };
  return withManifest<{ entry: ManifestEntry; duplicate: boolean }>(async (entries) => {
    // A parallel upload of the same file may have won the race.
    const twin = entries.find((e) => e.sha1 === sha1);
    if (twin) return { entries, result: { entry: twin, duplicate: true } };
    return { entries: [...entries, entry], result: { entry, duplicate: false } };
  }, dir);
}

/** Every manifest entry, with whether the app can actually use it. */
export async function listTracks(dir = dirOf()) {
  return (await readManifest(dir)).map((e) => ({
    ...e,
    usable: Boolean(e.license?.trim() && Array.isArray(e.moods) && e.moods.length && existsSync(path.join(dir, e.file))),
  }));
}

export async function updateTrack(file: string, patch: { moods?: string[]; title?: string; artist?: string }, dir = dirOf()) {
  return withManifest(async (entries) => {
    const i = entries.findIndex((e) => e.file === file);
    if (i < 0) return { entries, result: null };
    const next = { ...entries[i]!, ...(patch.title ? { title: patch.title } : {}), ...(patch.artist ? { artist: patch.artist } : {}), ...(patch.moods ? { moods: patch.moods } : {}) };
    const copy = [...entries];
    copy[i] = next;
    return { entries: copy, result: next };
  }, dir);
}

export async function removeTrack(file: string, dir = dirOf()) {
  return withManifest(async (entries) => {
    const hit = entries.find((e) => e.file === file);
    if (!hit) return { entries, result: false };
    const full = path.resolve(dir, hit.file);
    if (full.startsWith(path.resolve(dir))) await rm(full, { force: true });
    return { entries: entries.filter((e) => e.file !== file), result: true };
  }, dir);
}

/** Absolute path of a library file, or null (never escapes the library folder). */
export function trackPath(file: string, dir = dirOf()): string | null {
  if (!/^[a-z0-9-]+\.mp3$/.test(file)) return null;
  const full = path.resolve(dir, file);
  return full.startsWith(path.resolve(dir) + path.sep) && existsSync(full) ? full : null;
}
