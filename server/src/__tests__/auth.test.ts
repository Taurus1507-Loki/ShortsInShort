import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app, connectTestDb, lastEmailToken, PASSWORD, registerUser, resetDb } from './helpers.js';
import { Session } from '../models/Session.js';
import { Workspace } from '../models/Workspace.js';
import { User } from '../models/User.js';
import { sentEmails } from '../services/email.service.js';

beforeAll(connectTestDb);
beforeEach(resetDb);
afterAll(() => mongoose.disconnect());

describe('registration', () => {
  it('creates a user + workspace, returns an access token and an httpOnly SameSite=Strict refresh cookie', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Asha Rao', email: 'Asha@Example.com', password: PASSWORD, acceptTerms: true })
      .expect(201);

    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.user).toMatchObject({ email: 'asha@example.com', role: 'customer', emailVerified: false });
    expect(res.body.data.user.passwordHash).toBeUndefined();

    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/sis_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);

    const user = await User.findOne({ email: 'asha@example.com' }).select('+passwordHash');
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
    const ws = await Workspace.findById(user!.defaultWorkspaceId);
    expect(ws!.creditBalance).toBe(0); // credits only after verification
    expect(sentEmails.some((m) => m.tag === 'verify' && m.to === 'asha@example.com')).toBe(true);
  });

  it('rejects duplicate emails (case-insensitive)', async () => {
    await registerUser({ email: 'dup@example.com' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Dup', email: 'DUP@example.com', password: PASSWORD, acceptTerms: true })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects mass-assignment of privileged fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Eve', email: 'eve@example.com', password: PASSWORD, acceptTerms: true, role: 'super_admin' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await User.countDocuments({ email: 'eve@example.com' })).toBe(0);
  });

  it('enforces password policy and terms acceptance', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Weak', email: 'weak@example.com', password: 'short', acceptTerms: true })
      .expect(400);
    await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'NoTerms', email: 'noterms@example.com', password: PASSWORD, acceptTerms: false })
      .expect(400);
  });
});

describe('login', () => {
  it('logs in with correct credentials', async () => {
    const { email } = await registerUser();
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    expect(res.body.data.accessToken).toBeTypeOf('string');
  });

  it('returns the same generic error for wrong password and unknown email', async () => {
    const { email } = await registerUser();
    const a = await request(app).post('/api/auth/login').send({ email, password: 'WrongPassword1' }).expect(401);
    const b = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'WrongPassword1' }).expect(401);
    expect(a.body.error).toEqual(b.body.error);
  });

  it('blocks NoSQL operator injection', async () => {
    await registerUser({ email: 'victim@example.com' });
    await request(app).post('/api/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } }).expect(400);
  });

  it('rejects state-changing requests from disallowed origins', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@b.com', password: 'x' })
      .expect(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
  });
});

describe('sessions', () => {
  it('requires a bearer token for /me', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
  });

  it('returns the user and workspace for /me', async () => {
    const { auth } = await registerUser();
    const res = await request(app).get('/api/auth/me').set(auth).expect(200);
    expect(res.body.data.workspace).toMatchObject({ plan: 'free', creditBalance: 0 });
  });

  it('rotates the refresh token on each refresh', async () => {
    const { agent } = await registerUser();
    const r1 = await agent.post('/api/auth/refresh').expect(200);
    const r2 = await agent.post('/api/auth/refresh').expect(200);
    expect(String(r1.headers['set-cookie'])).not.toEqual(String(r2.headers['set-cookie']));
  });

  it('revokes the session when a rotated refresh token is replayed after the grace window', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Replay', email: 'replay@example.com', password: PASSWORD, acceptTerms: true })
      .expect(201);
    const original = String(reg.headers['set-cookie']).split(';')[0]!; // sis_rt=...

    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', original).expect(200);
    const fresh = String(rotated.headers['set-cookie']).split(';')[0]!;

    // Move rotation into the past so the replay is outside the race grace window.
    await Session.updateMany({}, { rotatedAt: new Date(Date.now() - 60_000) });

    await request(app).post('/api/auth/refresh').set('Cookie', original).expect(401); // theft detected
    await request(app).post('/api/auth/refresh').set('Cookie', fresh).expect(401); // whole session revoked
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${reg.body.data.accessToken}`).expect(401);
  });

  it('logout revokes the session immediately, including outstanding access tokens', async () => {
    const { agent, auth } = await registerUser();
    await agent.post('/api/auth/logout').expect(204);
    await agent.post('/api/auth/refresh').expect(401);
    await request(app).get('/api/auth/me').set(auth).expect(401);
  });

  it('lists sessions and can revoke other devices', async () => {
    const a = await registerUser();
    const b = await request(app).post('/api/auth/login').send({ email: a.email, password: PASSWORD }).expect(200);
    const list = await request(app).get('/api/users/me/sessions').set(a.auth).expect(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    await request(app).post('/api/users/me/sessions/revoke-others').set(a.auth).expect(204);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${b.body.data.accessToken}`).expect(401);
    await request(app).get('/api/auth/me').set(a.auth).expect(200);
  });
});

describe('email verification', () => {
  it('verifies once, grants starter credits exactly once, and rejects reused links', async () => {
    const { email, auth } = await registerUser();
    const token = lastEmailToken(email, 'verify');
    await request(app).post('/api/auth/verify-email').send({ token }).expect(200);
    const again = await request(app).post('/api/auth/verify-email').send({ token }).expect(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');

    const me = await request(app).get('/api/auth/me').set(auth).expect(200);
    expect(me.body.data.user.emailVerified).toBe(true);
    expect(me.body.data.workspace.creditBalance).toBe(3);
  });

  it('only the newest verification link is valid after a resend', async () => {
    const { email, auth } = await registerUser();
    const first = lastEmailToken(email, 'verify');
    await request(app).post('/api/auth/resend-verification').set(auth).expect(200);
    const second = lastEmailToken(email, 'verify');
    expect(second).not.toBe(first);
    await request(app).post('/api/auth/verify-email').send({ token: first }).expect(400);
    await request(app).post('/api/auth/verify-email').send({ token: second }).expect(200);
  });
});

describe('password reset & change', () => {
  it('responds identically for unknown emails (no account enumeration)', async () => {
    const { email } = await registerUser();
    const known = await request(app).post('/api/auth/forgot-password').send({ email }).expect(200);
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@example.com' }).expect(200);
    expect(known.body).toEqual(unknown.body);
    expect(sentEmails.filter((m) => m.tag === 'reset')).toHaveLength(1);
  });

  it('resets the password with a single-use token and signs out all devices', async () => {
    const { email, auth } = await registerUser();
    await request(app).post('/api/auth/forgot-password').send({ email }).expect(200);
    const token = lastEmailToken(email, 'reset');

    await request(app).post('/api/auth/reset-password').send({ token, password: 'BrandNewPass99' }).expect(200);
    await request(app).post('/api/auth/reset-password').send({ token, password: 'AnotherPass99' }).expect(400);

    await request(app).get('/api/auth/me').set(auth).expect(401);
    await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(401);
    await request(app).post('/api/auth/login').send({ email, password: 'BrandNewPass99' }).expect(200);
  });

  it('changes password with the current one and keeps only the current session', async () => {
    const a = await registerUser();
    const other = await request(app).post('/api/auth/login').send({ email: a.email, password: PASSWORD }).expect(200);

    await request(app)
      .post('/api/users/me/password')
      .set(a.auth)
      .send({ currentPassword: 'wrong-password1', newPassword: 'NewPassword123' })
      .expect(400);
    await request(app)
      .post('/api/users/me/password')
      .set(a.auth)
      .send({ currentPassword: PASSWORD, newPassword: 'NewPassword123' })
      .expect(200);

    await request(app).get('/api/auth/me').set(a.auth).expect(200);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${other.body.data.accessToken}`).expect(401);
  });
});

describe('account deletion', () => {
  it('requires the password, then anonymises the account and blocks sign-in', async () => {
    const { email, auth } = await registerUser({ verify: true });
    await request(app).delete('/api/users/me').set(auth).send({ confirm: 'DELETE', password: 'wrong-password1' }).expect(401);
    await request(app).delete('/api/users/me').set(auth).send({ confirm: 'DELETE', password: PASSWORD }).expect(204);

    await request(app).get('/api/auth/me').set(auth).expect(401);
    await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(401);
    expect(await User.countDocuments({ email })).toBe(0);
    // The email can be registered again.
    await registerUser({ email });
  });
});

describe('google sign-in', () => {
  it('reports not configured when credentials are absent', async () => {
    const res = await request(app).get('/api/auth/google').expect(503);
    expect(res.body.error.code).toBe('NOT_CONFIGURED');
    const meta = await request(app).get('/api/meta').expect(200);
    expect(meta.body.data.auth.google).toBe(false);
  });
});
