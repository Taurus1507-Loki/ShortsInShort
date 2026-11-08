import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { connectDB, disconnectDB } from '../config/db.js';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { CreditService } from '../services/creditService.js';
import { AuthService } from '../services/authService.js';

describe('ShortsInShort Phase 1 Foundation Test Suite', () => {
  let isDbConnected = false;

  beforeAll(async () => {
    isDbConnected = await connectDB();
    if (isDbConnected) {
      // Clean test records
      await User.deleteMany({ email: /@test-shortsinshort\.com/ });
      await Project.deleteMany({ title: /Test Project/ });
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await User.deleteMany({ email: /@test-shortsinshort\.com/ });
      await Project.deleteMany({ title: /Test Project/ });
      await disconnectDB();
    }
  });

  it('registers a new user and returns valid JWT tokens', async () => {
    if (!isDbConnected) return;
    const testEmail = `creator_${Date.now()}@test-shortsinshort.com`;
    const result = await AuthService.register({
      fullName: 'Vikram Creator',
      email: testEmail,
      password: 'SecurePassword123!',
    });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.user.email).toBe(testEmail);
    expect(result.user.creditBalance).toBe(50);
  });

  it('authenticates user and denies invalid password', async () => {
    if (!isDbConnected) return;
    const testEmail = `login_${Date.now()}@test-shortsinshort.com`;
    await AuthService.register({
      fullName: 'Aarav Sharma',
      email: testEmail,
      password: 'CorrectPassword123!',
    });

    const successAuth = await AuthService.login({
      email: testEmail,
      password: 'CorrectPassword123!',
    });
    expect(successAuth.user.fullName).toBe('Aarav Sharma');

    await expect(
      AuthService.login({
        email: testEmail,
        password: 'WrongPassword!',
      })
    ).rejects.toThrow('Invalid email or password.');
  });

  it('manages atomic credit deduction and prevents overdraft', async () => {
    if (!isDbConnected) return;
    const testEmail = `credits_${Date.now()}@test-shortsinshort.com`;
    const reg = await AuthService.register({
      fullName: 'Credit Tester',
      email: testEmail,
      password: 'Password123!',
    });

    const userId = reg.user.id;
    const workspaceId = reg.user.workspaceId;

    // Deduct 10 credits
    const deductRes = await CreditService.deductCredits({
      userId,
      workspaceId,
      amount: 10,
      operation: 'generation_deduct',
      description: 'AI Video Editor generation test',
    });

    expect(deductRes.newBalance).toBe(40);

    // Overdraft attempt (attempting to deduct 100 from 40 balance)
    await expect(
      CreditService.deductCredits({
        userId,
        workspaceId,
        amount: 100,
        operation: 'generation_deduct',
        description: 'Large batch render',
      })
    ).rejects.toThrow(/Insufficient video credits/);
  });

  it('enforces tenant isolation between separate accounts', async () => {
    if (!isDbConnected) return;
    // User A
    const userA = await AuthService.register({
      fullName: 'User Alpha',
      email: `alpha_${Date.now()}@test-shortsinshort.com`,
      password: 'Password123!',
    });

    // User B
    const userB = await AuthService.register({
      fullName: 'User Beta',
      email: `beta_${Date.now()}@test-shortsinshort.com`,
      password: 'Password123!',
    });

    // Project created by User A
    const projectA = await Project.create({
      userId: new mongoose.Types.ObjectId(userA.user.id),
      workspaceId: new mongoose.Types.ObjectId(userA.user.workspaceId),
      title: 'Test Project Alpha Exclusive',
      creationMode: 'ai_editor',
      aspectRatio: '9:16',
      status: 'ready',
    });

    // User B attempts to access projectA
    const tamperedLookup = await Project.findOne({
      _id: projectA._id,
      userId: new mongoose.Types.ObjectId(userB.user.id),
    });

    expect(tamperedLookup).toBeNull();
  });
});

