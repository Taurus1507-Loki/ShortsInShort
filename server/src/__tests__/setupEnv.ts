import { inject } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Runs before any test module imports src/config/env.ts.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = inject('mongoUri');
process.env.JWT_ACCESS_SECRET = 'test-secret-that-is-definitely-longer-than-32-chars';
process.env.APP_URL = 'http://localhost:5173';
process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
process.env.FREE_PLAN_CREDITS = '3';
// Blank (not delete) every external credential: dotenv never overrides an existing variable, so
// this guarantees tests can't pick up real keys from server/.env and call paid services.
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'DEEPGRAM_API_KEY', 'GEMINI_API_KEY', 'PIXABAY_API_KEY', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
  process.env[k] = '';
}
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), 'sis-test-storage-'));
process.env.WORKER_MODE = 'off';
process.env.MAX_UPLOAD_MB = '50';
// Empty licensed-music folder; tests that need music write a manifest into it.
process.env.MUSIC_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), 'sis-test-music-'));
