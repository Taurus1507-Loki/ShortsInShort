import { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { CREDIT_PACKS, PLANS, type PlanId } from '../../config/plans.js';
import { LIVE_SUBSCRIPTION_STATUSES, Payment, ProviderPlan, Subscription, type PaymentDoc, type SubscriptionDoc } from '../../models/Billing.js';
import { Workspace } from '../../models/Workspace.js';
import { User } from '../../models/User.js';
import { applyCreditChange } from '../credit.service.js';
import { audit } from '../audit.service.js';
import { sendEmail, emails } from '../email.service.js';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors.js';
import { getPaymentProvider, PaymentError, type RazorpayProvider } from './razorpay.js';
import { issueInvoice } from './invoice.js';

export type Period = 'monthly' | 'yearly';
export const planPrice = (planId: PlanId, period: Period) => (period === 'yearly' ? PLANS[planId].annualPricePaise : PLANS[planId].monthlyPricePaise);
/** Credits granted per charge: annual plans get the whole year's credits with each yearly charge. */
export const creditsPerCharge = (planId: PlanId, period: Period) => PLANS[planId].monthlyCredits * (period === 'yearly' ? 12 : 1);
const PLAN_RANK: Record<string, number> = { free: 0, starter: 1, creator: 2, pro: 3, agency: 4 };

export function provider(): RazorpayProvider {
  const p = getPaymentProvider();
  if (!p) throw new AppError(503, 'NOT_CONFIGURED', 'Online payments are not configured on this server yet.');
  return p;
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PaymentError) throw new AppError(err.status === 401 ? 503 : 502, 'PAYMENT_PROVIDER_ERROR', err.message);
    throw err;
  }
}

/* ── Credit top-ups ─────────────────────────────────────────────────── */

export async function startTopUp(workspaceId: Types.ObjectId, userId: Types.ObjectId, packId: string) {
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) throw badRequest('That credit pack doesn’t exist.', 'INVALID_PACK');
  const rzp = provider();
  const payment = await Payment.create({ workspaceId, userId, kind: 'credits', amountPaise: pack.pricePaise, packId: pack.id, credits: pack.credits });
  // The receipt is our payment id: Razorpay refuses duplicate receipts, so a retried request can't create two orders.
  const order = await call(() => rzp.createOrder({ amountPaise: pack.pricePaise, receipt: payment._id.toString(), notes: { workspaceId: workspaceId.toString(), paymentId: payment._id.toString(), packId: pack.id } }));
  payment.orderId = order.id;
  await payment.save();
  return { orderId: order.id, amountPaise: pack.pricePaise, currency: 'INR', keyId: rzp.keyId, credits: pack.credits };
}

/**
 * Marks a top-up paid and grants its credits — exactly once, whether called from Checkout's success
 * handler or a webhook (in any order, any number of times).
 */
export async function fulfilTopUp(payment: PaymentDoc, providerPaymentId: string) {
  await Payment.updateOne({ _id: payment._id, status: { $ne: 'paid' } }, { $set: { status: 'paid', paymentId: providerPaymentId, paidAt: new Date(), failureReason: null } });
  const fresh = (await Payment.findById(payment._id))!;
  const credit = await applyCreditChange({
    workspaceId: fresh.workspaceId as Types.ObjectId,
    type: 'purchase',
    amount: fresh.credits,
    idempotencyKey: `purchase:${fresh._id.toString()}`,
    note: `Bought ${fresh.credits} credits`,
    reference: { kind: 'payment', id: fresh._id.toString() },
    actorId: fresh.userId,
  });
  const invoice = await issueInvoice(fresh, `${fresh.credits} ShortsInShort credits (top-up)`);
  if (!fresh.invoiceId) await Payment.updateOne({ _id: fresh._id }, { $set: { invoiceId: invoice._id } });
  if (!credit.duplicate) {
    await audit(null, 'billing.topup', { actorId: fresh.userId, workspaceId: fresh.workspaceId as Types.ObjectId, metadata: { paymentId: fresh._id.toString(), credits: fresh.credits } });
    await notifyPaid(fresh, invoice.number, `${fresh.credits} credits were added to your workspace.`);
  }
  return { credited: !credit.duplicate, invoiceId: invoice._id.toString() };
}

async function notifyPaid(payment: PaymentDoc, invoiceNumber: string, what: string) {
  const user = payment.userId ? await User.findById(payment.userId).select('email fullName').lean() : null;
  if (user) await sendEmail(emails.paymentReceipt(user.email, user.fullName, (payment.amountPaise / 100).toFixed(2), what, invoiceNumber)).catch((err) => logger.warn({ err }, 'Receipt email failed'));
}

/* ── Subscriptions ──────────────────────────────────────────────────── */

/** The Razorpay plan for (plan, period, price), created on first use and remembered. */
export async function ensureProviderPlan(planId: PlanId, period: Period): Promise<string> {
  const amount = planPrice(planId, period);
  const key = `${planId}:${period}:${amount}`;
  const existing = await ProviderPlan.findOne({ key });
  if (existing) return existing.providerPlanId;
  const created = await call(() => provider().createPlan({ period, name: `ShortsInShort ${PLANS[planId].name} (${period})`, amountPaise: amount, notes: { planId, period } }));
  try {
    await ProviderPlan.create({ key, providerPlanId: created.id });
    return created.id;
  } catch {
    return (await ProviderPlan.findOne({ key }))!.providerPlanId; // created concurrently
  }
}

async function planFromProvider(providerPlanId: string): Promise<{ planId: PlanId; period: Period } | null> {
  const p = await ProviderPlan.findOne({ providerPlanId }).lean();
  if (!p) return null;
  const [planId, period] = p.key.split(':') as [PlanId, Period];
  return { planId, period };
}

export const currentSubscription = (workspaceId: Types.ObjectId) =>
  Subscription.findOne({ workspaceId, status: { $in: LIVE_SUBSCRIPTION_STATUSES } }).sort({ createdAt: -1 });

export async function startSubscription(workspaceId: Types.ObjectId, userId: Types.ObjectId, planId: PlanId, period: Period) {
  if (!PLANS[planId] || planPrice(planId, period) <= 0) throw badRequest('Choose a paid plan.', 'INVALID_PLAN');
  const live = await currentSubscription(workspaceId);
  if (live && live.status !== 'created') throw conflict('You already have a subscription. Change or cancel it instead.', 'ALREADY_SUBSCRIBED');
  const rzp = provider();
  const providerPlanId = await ensureProviderPlan(planId, period);
  const sub = await call(() =>
    rzp.createSubscription({ planId: providerPlanId, totalCount: period === 'yearly' ? 10 : 120, notes: { workspaceId: workspaceId.toString(), planId, period } }),
  );
  // An abandoned earlier checkout is replaced by this one.
  if (live) await Subscription.updateOne({ _id: live._id }, { $set: { status: 'expired', endedAt: new Date() } });
  await Subscription.create({ workspaceId, userId, providerSubscriptionId: sub.id, providerPlanId, planId, period, status: sub.status || 'created' });
  return { subscriptionId: sub.id, keyId: rzp.keyId, amountPaise: planPrice(planId, period) };
}

/**
 * A successful subscription charge (first payment or renewal): records the payment once, puts the
 * workspace on the plan and grants the cycle's credits, then issues the invoice.
 */
export async function recordSubscriptionCharge(sub: SubscriptionDoc, providerPaymentId: string, amountPaise: number | null, period?: { start?: number | null; end?: number | null }) {
  const planId = sub.planId as PlanId;
  const per = sub.period as Period;
  const credits = creditsPerCharge(planId, per);
  let payment = await Payment.findOne({ paymentId: providerPaymentId });
  if (!payment) {
    try {
      payment = await Payment.create({
        workspaceId: sub.workspaceId,
        userId: sub.userId,
        kind: 'subscription',
        paymentId: providerPaymentId,
        subscriptionId: sub.providerSubscriptionId,
        amountPaise: amountPaise ?? planPrice(planId, per),
        status: 'paid',
        paidAt: new Date(),
        planId,
        period: per,
        credits,
      });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      payment = (await Payment.findOne({ paymentId: providerPaymentId }))!;
    }
  }
  const update: Record<string, unknown> = { status: 'active' };
  if (period?.start) update.currentStart = new Date(period.start * 1000);
  if (period?.end) update.currentEnd = new Date(period.end * 1000);
  await Subscription.updateOne({ _id: sub._id }, { $set: update });
  await Workspace.updateOne({ _id: sub.workspaceId }, { $set: { plan: planId } });
  const credit = await applyCreditChange({
    workspaceId: sub.workspaceId as Types.ObjectId,
    type: 'grant',
    amount: credits,
    idempotencyKey: `subcharge:${providerPaymentId}`,
    note: `${PLANS[planId].name} plan credits (${per})`,
    reference: { kind: 'payment', id: payment._id.toString() },
  });
  const invoice = await issueInvoice(payment, `ShortsInShort ${PLANS[planId].name} plan — ${per === 'yearly' ? '12 months' : '1 month'} (${credits} credits)`);
  if (!payment.invoiceId) await Payment.updateOne({ _id: payment._id }, { $set: { invoiceId: invoice._id } });
  if (!credit.duplicate) {
    await audit(null, 'billing.subscription_charged', { workspaceId: sub.workspaceId as Types.ObjectId, metadata: { subscription: sub.providerSubscriptionId, planId, credits } });
    await notifyPaid(payment, invoice.number, `Your ${PLANS[planId].name} plan is active and ${credits} credits were added.`);
  }
}

/** Applies a Razorpay subscription entity from a webhook (status, cycle dates, scheduled plan changes). */
export async function syncSubscription(entity: { id: string; status?: string; plan_id?: string; current_start?: number | null; current_end?: number | null }, event: string, paymentEntity?: { id: string; amount?: number } | null) {
  const sub = await Subscription.findOne({ providerSubscriptionId: entity.id });
  if (!sub) {
    logger.warn({ subscription: entity.id, event }, 'Webhook for an unknown subscription');
    return;
  }
  // A scheduled downgrade takes effect when Razorpay reports the new plan.
  if (entity.plan_id && entity.plan_id !== sub.providerPlanId) {
    const mapped = await planFromProvider(entity.plan_id);
    if (mapped) {
      sub.set({ providerPlanId: entity.plan_id, planId: mapped.planId, period: mapped.period, scheduledPlanId: null });
      await sub.save();
    }
  }
  const set: Record<string, unknown> = {};
  if (entity.status) set.status = entity.status;
  if (entity.current_start) set.currentStart = new Date(entity.current_start * 1000);
  if (entity.current_end) set.currentEnd = new Date(entity.current_end * 1000);
  if (Object.keys(set).length) await Subscription.updateOne({ _id: sub._id }, { $set: set });

  if (event === 'subscription.charged' && paymentEntity?.id) {
    await recordSubscriptionCharge(sub, paymentEntity.id, paymentEntity.amount ?? null, { start: entity.current_start, end: entity.current_end });
  }
  if (['subscription.cancelled', 'subscription.completed', 'subscription.expired'].includes(event) || ['cancelled', 'completed', 'expired'].includes(entity.status ?? '')) {
    await Subscription.updateOne({ _id: sub._id }, { $set: { endedAt: new Date() } });
    // Only the workspace's newest subscription decides its plan.
    const newest = await Subscription.findOne({ workspaceId: sub.workspaceId }).sort({ createdAt: -1 });
    if (newest?._id.equals(sub._id)) await Workspace.updateOne({ _id: sub.workspaceId }, { $set: { plan: 'free' } });
  }
}

export async function cancelSubscription(workspaceId: Types.ObjectId) {
  const sub = await currentSubscription(workspaceId);
  if (!sub || !['active', 'authenticated', 'pending', 'halted'].includes(sub.status)) throw notFound('You don’t have an active subscription.', 'NO_SUBSCRIPTION');
  await call(() => provider().cancelSubscription(sub.providerSubscriptionId, true));
  sub.cancelAtCycleEnd = true;
  await sub.save();
  return sub;
}

/** Upgrades apply now (with the extra monthly credits granted at once); downgrades at the end of the cycle. */
export async function changePlan(workspaceId: Types.ObjectId, planId: PlanId) {
  const sub = await currentSubscription(workspaceId);
  if (!sub || sub.status !== 'active') throw notFound('You don’t have an active subscription to change.', 'NO_SUBSCRIPTION');
  if (sub.planId === planId) throw badRequest('You’re already on that plan.', 'SAME_PLAN');
  if (planPrice(planId, sub.period as Period) <= 0) throw badRequest('To move to Free, cancel the subscription.', 'INVALID_PLAN');
  const upgrade = PLAN_RANK[planId]! > PLAN_RANK[sub.planId]!;
  const providerPlanId = await ensureProviderPlan(planId, sub.period as Period);
  try {
    await provider().updateSubscription(sub.providerSubscriptionId, { planId: providerPlanId, when: upgrade ? 'now' : 'cycle_end' });
  } catch (err) {
    if (err instanceof PaymentError && /upi|emandate/i.test(err.message)) {
      throw new AppError(409, 'PLAN_CHANGE_UNSUPPORTED', 'Plans paid by UPI or bank mandate can’t be changed in place. Cancel this subscription and subscribe to the new plan.');
    }
    if (err instanceof PaymentError) throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', err.message);
    throw err;
  }
  if (upgrade) {
    const from = sub.planId as PlanId;
    const extra = creditsPerCharge(planId, sub.period as Period) - creditsPerCharge(from, sub.period as Period);
    sub.set({ planId, providerPlanId, scheduledPlanId: null });
    await sub.save();
    await Workspace.updateOne({ _id: workspaceId }, { $set: { plan: planId } });
    if (extra > 0) {
      await applyCreditChange({
        workspaceId,
        type: 'grant',
        amount: extra,
        idempotencyKey: `upgrade:${sub.providerSubscriptionId}:${from}->${planId}:${sub.currentStart?.getTime() ?? 0}`,
        note: `Upgrade ${PLANS[from].name} → ${PLANS[planId].name}`,
      });
    }
  } else {
    sub.scheduledPlanId = planId;
    await sub.save();
  }
  return { upgrade, sub };
}

export const billingConfigured = () => Boolean(getPaymentProvider());
export const pricesIncludeGst = () => env.billing.pricesIncludeGst;
