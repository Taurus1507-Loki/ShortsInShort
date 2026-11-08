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
delete process.env.SMTP_HOST;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), 'sis-test-storage-'));
process.env.WORKER_MODE = 'off';
process.env.MAX_UPLOAD_MB = '50';
