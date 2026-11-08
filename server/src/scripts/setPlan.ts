/**
 * Admin tool: set a user's workspace plan and/or add credits (development & support use).
 *   npm --prefix server run admin:plan -- <email> <plan> [credits]
 * e.g. npm --prefix server run admin:plan -- you@example.com agency 350
 *
 * Credits go through the ledger (type "adjust") and the change is audit-logged.
 * Until Razorpay billing exists (Phase 5), this is the only way to change plans.
 */
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { connectDB, disconnectDB } from '../config/db.js';
import { PLANS, PLAN_IDS, type PlanId } from '../config/plans.js';
import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { applyCreditChange } from '../services/credit.service.js';
import { audit } from '../services/audit.service.js';

const [email, plan, creditsArg] = process.argv.slice(2);
if (!email || !plan || !(PLAN_IDS as string[]).includes(plan)) {
  console.error(`Usage: npm --prefix server run admin:plan -- <email> <${PLAN_IDS.join('|')}> [credits]`);
  process.exit(1);
}
const credits = creditsArg === undefined ? 0 : Number(creditsArg);
if (!Number.isInteger(credits) || credits < 0) {
  console.error('credits must be a whole number ≥ 0');
  process.exit(1);
}

await connectDB(env.mongodbUri);
try {
  const user = await User.findOne({ email: email.toLowerCase(), status: 'active' });
  if (!user) throw new Error(`No active user with email ${email}`);

  const ws = await Workspace.findByIdAndUpdate(user.defaultWorkspaceId, { $set: { plan } }, { new: true });
  if (!ws) throw new Error('Workspace not found');

  let balance = ws.creditBalance;
  if (credits > 0) {
    const r = await applyCreditChange({
      workspaceId: ws._id,
      type: 'adjust',
      amount: credits,
      idempotencyKey: `admin-adjust:${randomUUID()}`,
      note: `Admin: ${PLANS[plan as PlanId].name} plan credits`,
    });
    balance = r.balanceAfter ?? balance;
  }
  await audit(null, 'admin.plan_changed', { actorId: null, workspaceId: ws._id, metadata: { email: user.email, plan, creditsAdded: credits, via: 'cli' } });

  const p = PLANS[plan as PlanId];
  console.log(`✓ ${user.email} → ${p.name} plan (${p.maxResolution} exports, ${Math.round(p.storageBytes / 1024 ** 3)} GB storage)`);
  console.log(`✓ Credits added: ${credits} · balance now ${balance}`);
  console.log(`  Email verified: ${user.emailVerifiedAt ? 'yes' : 'NO — verify it to create projects'}`);
} catch (err) {
  console.error(`✗ ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await disconnectDB();
}
