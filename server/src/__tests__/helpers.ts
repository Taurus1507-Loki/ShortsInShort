import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { connectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { sentEmails } from '../services/email.service.js';

export const app = createApp();

export async function connectTestDb() {
  if (mongoose.connection.readyState !== 1) await connectDB(env.mongodbUri);
}

export async function resetDb() {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  sentEmails.length = 0;
}

export const PASSWORD = 'CorrectHorse42battery';

let counter = 0;
/** Registers a user via the API and returns a cookie-keeping agent plus its access token. */
export async function registerUser(opts: { verify?: boolean; email?: string; name?: string } = {}) {
  const agent = request.agent(app);
  const email = opts.email ?? `user${++counter}_${Date.now()}@example.com`;
  const res = await agent
    .post('/api/auth/register')
    .send({ fullName: opts.name ?? 'Test Creator', email, password: PASSWORD, acceptTerms: true });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  let token = res.body.data.accessToken as string;
  if (opts.verify) {
    await agent.post('/api/auth/verify-email').send({ token: lastEmailToken(email, 'verify') }).expect(200);
    // Refresh to pick up nothing new in the token, but keeps flow realistic.
    token = (await agent.post('/api/auth/refresh').expect(200)).body.data.accessToken;
  }
  return { agent, email, token, auth: { Authorization: `Bearer ${token}` }, user: res.body.data.user };
}

/** Extracts the `token=` query value from the most recent email of `tag` sent to `to`. */
export function lastEmailToken(to: string, tag: string): string {
  const msg = [...sentEmails].reverse().find((m) => m.to === to && m.tag === tag);
  if (!msg) throw new Error(`no ${tag} email for ${to}`);
  const match = msg.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error('no token in email');
  return match[1];
}
