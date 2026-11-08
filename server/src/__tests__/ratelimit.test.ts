import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app, connectTestDb, lastEmailToken, registerUser, resetDb } from './helpers.js';

beforeAll(async () => {
  await connectTestDb();
  await resetDb();
  process.env.RATE_LIMIT_TESTS = '1'; // enable real rate limiting for this file only
});
afterAll(async () => {
  delete process.env.RATE_LIMIT_TESTS;
  await mongoose.disconnect();
});

describe('rate limits', () => {
  it('lets the verification link work even after repeated "Resend email" clicks', async () => {
    const { email, auth } = await registerUser();
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/resend-verification').set(auth).expect(200);
    // The 6th resend is throttled…
    const blocked = await request(app).post('/api/auth/resend-verification').set(auth).expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    // …but the newest link still verifies: the two actions have separate allowances.
    await request(app).post('/api/auth/verify-email').send({ token: lastEmailToken(email, 'verify') }).expect(200);
  });

  it('throttles resends per account, not for everyone on the same network', async () => {
    const other = await registerUser();
    await request(app).post('/api/auth/resend-verification').set(other.auth).expect(200);
  });
});
