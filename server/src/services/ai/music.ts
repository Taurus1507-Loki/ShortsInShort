import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';

/**
 * Licensed music library read from a folder you control:
 *
 *   MUSIC_LIBRARY_DIR/
 *     music.json   ← manifest (below)
 *     uplifting-1.mp3, calm-piano.mp3, …
 *
 * music.json: [{ "file": "calm-piano.mp3", "title": "Calm Piano", "artist": "…",
 *               "moods": ["calm", "lofi"], "license": "Epidemic Sound subscription #123",
 *               "licenseUrl": "https://…" }]
 *
 * Only tracks that exist AND declare a license are used. Nothing is downloaded or generated, so the
 * app never ships music you don't have rights to.
 */
export interface MusicTrack {
  file: string;
  title: string;
  artist: string;
  moods: string[];
  license: string;
  licenseUrl?: string;
  /** Absolute path (resolved). */
  path: string;
}

export const MOODS = ['upbeat', 'calm', 'cinematic', 'corporate', 'lofi'] as const;

/** Mood used when the project's music is "auto" (matches the editing style). */
export const STYLE_MOOD: Record<string, string> = {
  viral: 'upbeat',
  podcast: 'lofi',
  cinematic: 'cinematic',
  educational: 'calm',
  business: 'corporate',
  storytelling: 'cinematic',
  vlog: 'upbeat',
  product_promotion: 'upbeat',
};

/** Loads and validates the manifest. Exported for tests (pass a directory). */
export function loadLibrary(dir: string | null = env.music.libraryDir): MusicTrack[] {
  if (!dir) return [];
  const manifest = path.join(dir, 'music.json');
  if (!existsSync(manifest)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t: Partial<MusicTrack>) => {
    if (!t?.file || !t.license?.trim() || !Array.isArray(t.moods)) return [];
    const full = path.resolve(dir, t.file);
    if (!full.startsWith(path.resolve(dir)) || !existsSync(full)) return [];
    return [{ file: t.file, title: t.title ?? t.file, artist: t.artist ?? 'Unknown', moods: t.moods.map((m) => String(m).toLowerCase()), license: t.license.trim(), licenseUrl: t.licenseUrl, path: full }];
  });
}

/**
 * Picks a track for a mood ("auto" → derived from the editing style). Deterministic per project so
 * re-renders keep the same music; falls back to any licensed track if none matches the mood.
 */
export function pickTrack(library: MusicTrack[], mood: string, style: string, seed: string): MusicTrack | null {
  if (!library.length || mood === 'none') return null;
  const want = mood === 'auto' ? (STYLE_MOOD[style] ?? 'upbeat') : mood;
  const pool = library.filter((t) => t.moods.includes(want));
  const list = pool.length ? pool : library;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length]!;
}
