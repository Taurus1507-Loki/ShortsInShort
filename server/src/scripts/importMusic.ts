/**
 * Bulk-adds Pixabay Music tracks you downloaded to the background-music library (same checks as the
 * admin Music library page: real audio, 10 s–15 min, loudness-normalised, moods guessed from the name).
 *
 *   npm run music:import -- "C:/Users/me/Downloads/pixabay-music"
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { importTrack, MusicImportError } from '../services/ai/musicLibrary.js';

const src = process.argv[2];
if (!src) {
  console.error('Usage: npm run music:import -- <folder with .mp3/.m4a/.wav/.ogg files>');
  process.exit(1);
}
const files = (await readdir(src)).filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f));
console.log(`Importing ${files.length} file(s) into ${env.music.libraryDir}`);
let added = 0;
for (const f of files) {
  try {
    const { entry, duplicate } = await importTrack(path.join(src, f), f);
    if (!duplicate) added++;
    console.log(`${duplicate ? '= already there' : '+ added'}  ${entry.title} — ${entry.artist}  [${entry.moods.join(', ')}]  ${entry.durationSec ?? '?'} s`);
  } catch (err) {
    console.log(`! skipped ${f}: ${err instanceof MusicImportError ? err.message : (err as Error).message}`);
  }
}
console.log(`Done: ${added} added. Review moods in Admin → Music library.`);
