import { inject } from 'vitest';

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
