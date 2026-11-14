import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth, requireVerifiedEmail } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AppError, asyncHandler, badRequest, notFound } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { CREDIT_PACKS, PAID_PLAN_IDS, PLANS, type PlanId } from '../../config/plans.js';
import { Invoice, Payment, Subscription, WebhookEvent, toPublicInvoice, toPublicPayment } from '../../models/Billing.js';
import { Workspace } from '../../models/Workspace.js';
import { sha256 } from '../../utils/crypto.js';
import { audit } from '../../services/audit.service.js';
import {
  billingConfigured,
  cancelSubscription,
  changePlan,
  creditsPerCharge,
  currentSubscription,
  fulfilTopUp,
  planPrice,
  provider,
  recordSubscriptionCharge,
  startSubscription,
  startTopUp,
  syncSubscription,
  type Period,
} from '../../services/payments/billing.js';
import { getPaymentProvider } from '../../services/payments/razorpay.js';
import { invoicePdf } from '../../services/payments/invoice.js';

export const billingRouter = Router();
billingRouter.use(requireAuth);

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Plans, packs, the workspace's subscription and billing details — everything the Billing page shows. */
billingRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.auth!;
    const ws = await Workspace.findById(workspaceId).select('plan creditBalance billing').lean();
    const sub = await currentSubscription(workspaceId);
    res.json({
      data: {
        configured: billingConfigured(),
        keyId: getPaymentProvider()?.keyId ?? null,
        pricesIncludeGst: env.billing.pricesIncludeGst,
        gstRate: env.billing.gstRate,
        plan: ws?.plan ?? 'free',
        plans: PAID_PLAN_IDS.map((id) => ({ id, name: PLANS[id].name, monthlyPaise: planPrice(id, 'monthly'), yearlyPaise: planPrice(id, 'yearly'), monthlyCredits: PLANS[id].monthlyCredits, yearlyCredits: creditsPerCharge(id, 'yearly') })),
        packs: CREDIT_PACKS,
        subscription: sub
          ? { planId: sub.planId, period: sub.period, status: sub.status, currentEnd: sub.currentEnd, cancelAtCycleEnd: sub.cancelAtCycleEnd, scheduledPlanId: sub.scheduledPlanId }
          : null,
        billing: { legalName: ws?.billing?.legalName ?? '', gstin: ws?.billing?.gstin ?? '', address: ws?.billing?.address ?? '', stateCode: ws?.billing?.stateCode ?? '' },
      },
    });
  }),
);

/** Billing details printed on invoices (GSTIN for business buyers, state for CGST/SGST vs IGST). */
billingRouter.put(
  '/profile',
  validate({
    body: z
      .object({
        legalName: z.string().trim().max(120),
        gstin: z.union([z.literal(''), z.string().trim().toUpperCase().regex(GSTIN_RE, 'Enter a valid 15-character GSTIN')]),
        address: z.string().trim().max(300),
        stateCode: z.union([z.literal(''), z.string().regex(/^\d{2}$/, 'Choose your state')]),
      })
      .strict()
      .refine((b) => !b.gstin || b.gstin.slice(0, 2) === b.stateCode, { message: 'The GSTIN’s first two digits must match your state.', path: ['gstin'] }),
  }),
  asyncHandler(async (req, res) => {
    await Workspace.updateOne({ _id: req.auth!.workspaceId }, { $set: { billing: req.body } });
    res.json({ data: req.body });
  }),
);

/* ── Credit top-ups ─────────────────────────────────────────────────── */

billingRouter.post(
  '/orders',
  requireVerifiedEmail,
  validate({ body: z.object({ packId: z.string().max(30) }).strict() }),
  asyncHandler(async (req, res) => {
    const { workspaceId, user } = req.auth!;
    const data = await startTopUp(workspaceId, user._id, req.body.packId);
    res.status(201).json({ data: { ...data, prefill: { name: user.fullName, email: user.email } } });
  }),
);

/** Checkout success: verify the signature against OUR order id, then fulfil (idempotent). */
billingRouter.post(
  '/orders/verify',
  validate({ body: z.object({ orderId: z.string().max(60), paymentId: z.string().max(60), signature: z.string().max(200) }).strict() }),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.auth!;
    const payment = await Payment.findOne({ orderId: req.body.orderId, workspaceId, kind: 'credits' });
    if (!payment) throw notFound('Payment not found.');
    if (!provider().verifyOrderPayment(payment.orderId!, req.body.paymentId, req.body.signature)) {
      await audit(req, 'billing.signature_invalid', { workspaceId, metadata: { orderId: req.body.orderId } });
      throw badRequest('The payment could not be verified.', 'INVALID_SIGNATURE');
    }
    const r = await fulfilTopUp(payment, req.body.paymentId);
    const ws = await Workspace.findById(workspaceId).select('creditBalance').lean();
    res.json({ data: { ...r, creditBalance: ws?.creditBalance ?? 0 } });
  }),
);

/* ── Subscriptions ──────────────────────────────────────────────────── */

const planBody = z.object({ planId: z.enum(PAID_PLAN_IDS as [PlanId, ...PlanId[]]), period: z.enum(['monthly', 'yearly']) }).strict();

billingRouter.post(
  '/subscriptions',
  requireVerifiedEmail,
  validate({ body: planBody }),
  asyncHandler(async (req, res) => {
    const { workspaceId, user } = req.auth!;
    const data = await startSubscription(workspaceId, user._id, req.body.planId, req.body.period as Period);
    res.status(201).json({ data: { ...data, prefill: { name: user.fullName, email: user.email } } });
  }),
);

billingRouter.post(
  '/subscriptions/verify',
  validate({ body: z.object({ subscriptionId: z.string().max(60), paymentId: z.string().max(60), signature: z.string().max(200) }).strict() }),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.auth!;
    const sub = await Subscription.findOne({ providerSubscriptionId: req.body.subscriptionId, workspaceId });
    if (!sub) throw notFound('Subscription not found.');
    if (!provider().verifySubscriptionPayment(sub.providerSubscriptionId, req.body.paymentId, req.body.signature)) {
      await audit(req, 'billing.signature_invalid', { workspaceId, metadata: { subscriptionId: req.body.subscriptionId } });
      throw badRequest('The payment could not be verified.', 'INVALID_SIGNATURE');
    }
    await recordSubscriptionCharge(sub, req.body.paymentId, null);
    const ws = await Workspace.findById(workspaceId).select('plan creditBalance').lean();
    res.json({ data: { plan: ws?.plan, creditBalance: ws?.creditBalance ?? 0 } });
  }),
);

billingRouter.post(
  '/subscriptions/cancel',
  asyncHandler(async (req, res) => {
    const sub = await cancelSubscription(req.auth!.workspaceId);
    await audit(req, 'billing.subscription_cancel', { actorId: req.auth!.user._id, workspaceId: req.auth!.workspaceId, metadata: { subscription: sub.providerSubscriptionId } });
    res.json({ data: { cancelAtCycleEnd: true, currentEnd: sub.currentEnd } });
  }),
);

billingRouter.post(
  '/subscriptions/change',
  validate({ body: z.object({ planId: z.enum(PAID_PLAN_IDS as [PlanId, ...PlanId[]]) }).strict() }),
  asyncHandler(async (req, res) => {
    const r = await changePlan(req.auth!.workspaceId, req.body.planId);
    await audit(req, 'billing.plan_change', { actorId: req.auth!.user._id, workspaceId: req.auth!.workspaceId, metadata: { to: req.body.planId, upgrade: r.upgrade } });
    res.json({ data: { upgrade: r.upgrade, planId: r.sub.planId, scheduledPlanId: r.sub.scheduledPlanId } });
  }),
);

/* ── History ────────────────────────────────────────────────────────── */

billingRouter.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const items = await Payment.find({ workspaceId: req.auth!.workspaceId, status: { $ne: 'created' } }).sort({ createdAt: -1 }).limit(100);
    res.json({ data: items.map(toPublicPayment) });
  }),
);

billingRouter.get(
  '/invoices',
  asyncHandler(async (req, res) => {
    const items = await Invoice.find({ workspaceId: req.auth!.workspaceId }).sort({ issuedAt: -1 }).limit(100);
    res.json({ data: items.map(toPublicInvoice) });
  }),
);

billingRouter.get(
  '/invoices/:id/pdf',
  validate({ params: z.object({ id: z.string().refine((v) => Types.ObjectId.isValid(v)) }) }),
  asyncHandler(async (req, res) => {
    const inv = await Invoice.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!inv) throw notFound('Invoice not found.');
    const pdf = await invoicePdf(inv);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${inv.number}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }),
);

/* ── Webhook (public; mounted before the JSON parser so the raw body can be verified) ── */

type RzpEntity = Record<string, unknown> & { id: string };
interface RzpEvent {
  event: string;
  payload: { payment?: { entity: RzpEntity }; order?: { entity: RzpEntity }; subscription?: { entity: RzpEntity } };
}

async function handleEvent(e: RzpEvent) {
  const pay = e.payload.payment?.entity as (RzpEntity & { order_id?: string; amount?: number; error_description?: string }) | undefined;
  switch (e.event) {
    case 'payment.captured':
    case 'order.paid': {
      const orderId = (e.payload.order?.entity?.id as string | undefined) ?? pay?.order_id;
      if (!orderId || !pay?.id) return;
      const payment = await Payment.findOne({ orderId, kind: 'credits' });
      if (payment) await fulfilTopUp(payment, pay.id);
      return;
    }
    case 'payment.failed': {
      if (!pay?.order_id) return;
      await Payment.updateOne({ orderId: pay.order_id, status: 'created' }, { $set: { status: 'failed', failureReason: (pay.error_description ?? 'Payment failed').slice(0, 300) } });
      return;
    }
    default:
      if (e.event.startsWith('subscription.') && e.payload.subscription?.entity) {
        await syncSubscription(e.payload.subscription.entity as never, e.event, pay ? { id: pay.id, amount: pay.amount } : null);
      }
  }
}

/**
 * Razorpay webhook: verifies `X-Razorpay-Signature` over the raw body, processes each event id once
 * (`x-razorpay-event-id`), and answers non-2xx on failure so Razorpay retries.
 */
export async function razorpayWebhook(req: Request, res: Response) {
  const rzp = getPaymentProvider();
  const raw = req.body as Buffer;
  if (!rzp || !Buffer.isBuffer(raw)) return res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'Payments are not configured.' } });
  if (!rzp.verifyWebhook(raw, req.get('x-razorpay-signature'))) {
    logger.warn({ ip: req.ip }, 'Rejected webhook with an invalid signature');
    return res.status(400).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature.' } });
  }
  let event: RzpEvent;
  try {
    event = JSON.parse(raw.toString('utf8')) as RzpEvent;
  } catch {
    return res.status(400).json({ error: { code: 'BAD_PAYLOAD', message: 'Invalid JSON.' } });
  }
  const eventId = req.get('x-razorpay-event-id') || sha256(raw.toString('utf8'));
  let record = await WebhookEvent.findOne({ eventId });
  if (record?.processedAt) return res.json({ ok: true, duplicate: true });
  record ??= await WebhookEvent.create({ eventId, event: event.event }).catch(async () => (await WebhookEvent.findOne({ eventId }))!);
  try {
    await handleEvent(event);
    await WebhookEvent.updateOne({ _id: record._id }, { $set: { processedAt: new Date(), error: null } });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err, event: event.event, eventId }, 'Webhook processing failed');
    await WebhookEvent.updateOne({ _id: record._id }, { $set: { error: err instanceof Error ? err.message.slice(0, 500) : 'failed' } });
    return res.status(500).json({ error: { code: 'WEBHOOK_FAILED', message: 'Processing failed; Razorpay will retry.' } });
  }
}

