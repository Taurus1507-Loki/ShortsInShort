import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { Job } from '../models/Job.js';
import { Project } from '../models/Project.js';
import { Payment, Subscription } from '../models/Billing.js';
import { ConsentRecord } from '../models/ConsentRecord.js';
import { CustomVoice } from '../models/CustomVoice.js';
import { AuditLog } from '../models/AuditLog.js';
import { CreditTransaction } from '../models/CreditTransaction.js';

beforeAll(connectTestDb);
beforeEach(resetDb);
afterAll(() => mongoose.disconnect());

async function admin(role: 'admin' | 'super_admin' = 'admin') {
  const u = await registerUser({ verify: true, name: role === 'admin' ? 'Admin Amy' : 'Super Sam' });
  await User.updateOne({ _id: u.user.id }, { role });
  return u;
}

describe('admin access', () => {
  it('is only for admins', async () => {
    const customer = await registerUser({ verify: true });
    await request(app).get('/api/admin/overview').expect(401);
    await request(app).get('/api/admin/overview').set(customer.auth).expect(403);
    await request(app).get('/api/admin/users').set(customer.auth).expect(403);
    const a = await admin();
    await request(app).get('/api/admin/overview').set(a.auth).expect(200);
  });
});

describe('overview and metrics', () => {
  it('summarises users, plans, revenue, jobs and daily series', async () => {
    const a = await admin();
    const c = await registerUser({ verify: true });
    await Workspace.updateOne({ _id: c.user.defaultWorkspaceId }, { plan: 'creator' });
    await Payment.create({ workspaceId: c.user.defaultWorkspaceId, kind: 'credits', amountPaise: 69900, status: 'paid', paidAt: new Date(), credits: 25 });
    await Job.create({ type: 'render_project', workspaceId: c.user.defaultWorkspaceId, status: 'completed' });
    await Job.create({ type: 'render_project', workspaceId: c.user.defaultWorkspaceId, status: 'dead', lastError: 'boom' });
    const o = (await request(app).get('/api/admin/overview').set(a.auth).expect(200)).body.data;
    expect(o.users).toMatchObject({ total: 2, verified: 2, suspended: 0, signups7: 2 });
    expect(o.plans).toMatchObject({ creator: 1, free: 1 });
    expect(o.revenue).toMatchObject({ last30Paise: 69900, payments30: 1 });
    expect(o.jobs30).toMatchObject({ completed: 1, failed: 1, failureRate: 50 });
    const m = (await request(app).get('/api/admin/metrics?days=7').set(a.auth).expect(200)).body.data;
    expect(m).toHaveLength(7);
    const today = m[m.length - 1];
    expect(today).toMatchObject({ signups: 2, rendersCompleted: 1, rendersFailed: 1, revenuePaise: 69900 });
  });
});

describe('user management', () => {
  it('searches users and shows details', async () => {
    const a = await admin();
    await registerUser({ verify: true, email: 'ravi.kumar@example.com', name: 'Ravi Kumar' });
    const list = (await request(app).get('/api/admin/users?q=ravi').set(a.auth).expect(200)).body;
    expect(list.meta.total).toBe(1);
    expect(list.data[0]).toMatchObject({ email: 'ravi.kumar@example.com', plan: 'free', role: 'customer', status: 'active' });
    const d = (await request(app).get(`/api/admin/users/${list.data[0].id}`).set(a.auth).expect(200)).body.data;
    expect(d.user.fullName).toBe('Ravi Kumar');
    expect(d.workspace.plan).toBe('free');
    expect(d.activeSessions).toBe(1);
  });

  it('adjusts credits once per request id, never below zero, with an audit trail', async () => {
    const a = await admin();
    const c = await registerUser({ verify: true });
    const before = (await Workspace.findById(c.user.defaultWorkspaceId))!.creditBalance;
    const requestId = randomUUID();
    const r1 = await request(app).post(`/api/admin/users/${c.user.id}/credits`).set(a.auth).send({ amount: 50, reason: 'Goodwill for a failed render', requestId }).expect(200);
    expect(r1.body.data).toMatchObject({ balance: before + 50, duplicate: false });
    const r2 = await request(app).post(`/api/admin/users/${c.user.id}/credits`).set(a.auth).send({ amount: 50, reason: 'Goodwill for a failed render', requestId }).expect(200);
    expect(r2.body.data.duplicate).toBe(true);
    expect((await Workspace.findById(c.user.defaultWorkspaceId))!.creditBalance).toBe(before + 50);
    await request(app).post(`/api/admin/users/${c.user.id}/credits`).set(a.auth).send({ amount: -100_000, reason: 'Too much', requestId: randomUUID() }).expect(402);
    await request(app).post(`/api/admin/users/${c.user.id}/credits`).set(a.auth).send({ amount: 5, reason: '', requestId: randomUUID() }).expect(400);
    const logs = await AuditLog.find({ action: 'admin.credits_adjust' }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata).toMatchObject({ targetUserId: c.user.id, amount: 50, reason: 'Goodwill for a failed render' });
    expect(await CreditTransaction.countDocuments({ type: 'adjust', status: 'applied' })).toBe(1);
  });

  it('changes plans manually only when there is no paid subscription', async () => {
    const a = await admin();
    const c = await registerUser({ verify: true });
    await request(app).post(`/api/admin/users/${c.user.id}/plan`).set(a.auth).send({ plan: 'pro', reason: 'Partner account' }).expect(200);
    expect((await Workspace.findById(c.user.defaultWorkspaceId))!.plan).toBe('pro');
    await Subscription.create({ workspaceId: c.user.defaultWorkspaceId, providerSubscriptionId: 'sub_X', providerPlanId: 'plan_X', planId: 'pro', period: 'monthly', status: 'active' });
    expect((await request(app).post(`/api/admin/users/${c.user.id}/plan`).set(a.auth).send({ plan: 'free', reason: 'x test' }).expect(409)).body.error.code).toBe('HAS_SUBSCRIPTION');
  });

  it('suspends immediately (sessions revoked) with admin/super-admin boundaries', async () => {
    const a = await admin();
    const c = await registerUser({ verify: true });
    await request(app).get('/api/auth/me').set(c.auth).expect(200);
    await request(app).post(`/api/admin/users/${c.user.id}/status`).set(a.auth).send({ status: 'suspended', reason: 'Spam uploads' }).expect(200);
    const blocked = await request(app).get('/api/auth/me').set(c.auth);
    expect([401, 403]).toContain(blocked.status);
    await request(app).post('/api/auth/login').send({ email: c.email, password: 'CorrectHorse42battery' }).expect(403);

    await request(app).post(`/api/admin/users/${a.user.id}/status`).set(a.auth).send({ status: 'suspended', reason: 'self test' }).expect(403);
    const other = await admin();
    await request(app).post(`/api/admin/users/${other.user.id}/status`).set(a.auth).send({ status: 'suspended', reason: 'not allowed' }).expect(403);
    const sup = await admin('super_admin');
    await request(app).post(`/api/admin/users/${other.user.id}/status`).set(sup.auth).send({ status: 'suspended', reason: 'super admin can' }).expect(200);
    await request(app).post(`/api/admin/users/${c.user.id}/status`).set(a.auth).send({ status: 'active', reason: 'Appeal accepted' }).expect(200);
    await request(app).post('/api/auth/login').send({ email: c.email, password: 'CorrectHorse42battery' }).expect(200);
  });

  it('lets only super admins change roles (never their own)', async () => {
    const a = await admin();
    const sup = await admin('super_admin');
    const c = await registerUser({ verify: true });
    await request(app).post(`/api/admin/users/${c.user.id}/role`).set(a.auth).send({ role: 'admin', reason: 'promote' }).expect(403);
    await request(app).post(`/api/admin/users/${c.user.id}/role`).set(sup.auth).send({ role: 'admin', reason: 'New support hire' }).expect(200);
    expect((await User.findById(c.user.id))!.role).toBe('admin');
    await request(app).post(`/api/admin/users/${sup.user.id}/role`).set(sup.auth).send({ role: 'customer', reason: 'self' }).expect(403);
    const unverified = await registerUser();
    expect((await request(app).post(`/api/admin/users/${unverified.user.id}/role`).set(sup.auth).send({ role: 'admin', reason: 'x test' }).expect(400)).body.error.code).toBe('NOT_VERIFIED');
  });
});

describe('operations', () => {
  it('retries a failed job for free', async () => {
    const a = await admin();
    const c = await registerUser({ verify: true });
    const p = await Project.create({ workspaceId: c.user.defaultWorkspaceId, createdBy: c.user.id, title: 'P', mode: 'editor', status: 'failed' });
    const job = await Job.create({ type: 'render_project', workspaceId: c.user.defaultWorkspaceId, projectId: p._id, status: 'dead', attempts: 3, lastError: 'provider outage', payload: { projectId: p._id.toString(), credits: 2 } });
    const list = (await request(app).get('/api/admin/jobs?status=dead').set(a.auth).expect(200)).body.data;
    expect(list[0]).toMatchObject({ id: job._id.toString(), error: 'provider outage', project: { title: 'P' } });
    await request(app).post(`/api/admin/jobs/${job._id}/retry`).set(a.auth).send({ reason: 'Outage fixed' }).expect(200);
    const j = await Job.findById(job._id);
    expect(j).toMatchObject({ status: 'queued', attempts: 0 });
    expect((j!.payload as { credits: number }).credits).toBe(0); // never charged again
    expect((await Project.findById(p._id))!.status).toBe('queued');
    await request(app).post(`/api/admin/jobs/${job._id}/retry`).set(a.auth).send({ reason: 'Outage fixed' }).expect(404);
  });

  it('takes down a cloned voice and lists payments and the audit log', async () => {
    const a = await admin();
    const c = await registerUser({ verify: true });
    const consent = await ConsentRecord.create({
      workspaceId: c.user.defaultWorkspaceId, createdBy: c.user.id, kind: 'voice', relationship: 'other', subjectName: 'Someone', subjectEmail: 's@example.com',
      statementText: 'I agree', attestations: { rightsAndConsent: true, notPublicFigure: true, acceptsUsePolicy: true }, status: 'active', revokeTokenHash: 'h',
    });
    await CustomVoice.create({ workspaceId: c.user.defaultWorkspaceId, createdBy: c.user.id, consentRecordId: consent._id, name: 'V', status: 'ready', providerVoiceId: 'v1' });
    const cs = (await request(app).get('/api/admin/consents?status=active').set(a.auth).expect(200)).body.data;
    expect(cs[0]).toMatchObject({ subjectName: 'Someone', voice: { name: 'V' } });
    await request(app).post(`/api/admin/consents/${consent._id}/revoke`).set(a.auth).send({ reason: 'Impersonation report' }).expect(200);
    expect(await ConsentRecord.findById(consent._id)).toMatchObject({ status: 'revoked', revokedBy: 'admin' });
    expect((await CustomVoice.findOne())!.status).toBe('revoked');

    await Payment.create({ workspaceId: c.user.defaultWorkspaceId, userId: new Types.ObjectId(c.user.id), kind: 'credits', amountPaise: 29900, status: 'failed', failureReason: 'Card declined' });
    const pays = (await request(app).get('/api/admin/payments?status=failed').set(a.auth).expect(200)).body.data;
    expect(pays[0]).toMatchObject({ status: 'failed', userEmail: c.email, failureReason: 'Card declined' });
    const log = (await request(app).get('/api/admin/audit?action=admin.').set(a.auth).expect(200)).body.data;
    expect(log.map((l: { action: string }) => l.action)).toContain('admin.consent_revoke');
    expect(log[0].actor).toBe(a.email);
  });
});
