import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { hmacHex, PaymentError, RazorpayProvider, setPaymentProvider, type Http } from '../services/payments/razorpay.js';
import { financialYear, gstBreakdown, invoiceNumber } from '../services/payments/invoice.js';
import { sentEmails } from '../services/email.service.js';
import { Invoice, Payment, ProviderPlan, Subscription } from '../models/Billing.js';
import { Workspace } from '../models/Workspace.js';
import { CreditTransaction } from '../models/CreditTransaction.js';

const KEY_SECRET = 'test_key_secret_123';
const WEBHOOK_SECRET = 'whsec_test_456';

/** Stand-in for Razorpay's REST API: records calls and returns realistic ids. */
let calls: Array<{ method: string; path: string; body: unknown }> = [];
let failNext: PaymentError | null = null;
let n = 0;
const fakeHttp: Http = async (method, path, body) => {
  calls.push({ method, path, body });
  // The simulated error is for the plan-change call (creating the new Razorpay plan still works).
  if (failNext && method === 'PATCH') {
    const e = failNext;
    failNext = null;
    throw e;
  }
  n++;
  if (path === '/orders') return { id: `order_T${n}`, amount: (body as { amount: number }).amount, status: 'created' };
  if (path === '/plans') return { id: `plan_T${n}` };
  if (path === '/subscriptions') return { id: `sub_T${n}`, status: 'created', short_url: 'https://rzp.io/i/x' };
  if (path.endsWith('/cancel')) return { id: path.split('/')[2], status: 'active' };
  if (method === 'PATCH') return { id: path.split('/')[2], plan_id: (body as { plan_id: string }).plan_id, status: 'active' };
  return {};
};

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetDb();
  calls = [];
  failNext = null;
  setPaymentProvider(new RazorpayProvider({ keyId: 'rzp_test_abc', keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET }, fakeHttp));
});
afterEach(() => setPaymentProvider(undefined));
afterAll(() => mongoose.disconnect());

async function buyer() {
  const u = await registerUser({ verify: true, name: 'Asha Rao' });
  return u;
}

function webhook(payload: object, eventId: string, secret = WEBHOOK_SECRET) {
  const raw = JSON.stringify(payload);
  return request(app)
    .post('/api/billing/webhook')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-event-id', eventId)
    .set('x-razorpay-signature', hmacHex(raw, secret))
    .send(raw);
}

describe('GST maths', () => {
  it('splits GST-inclusive prices exactly, CGST+SGST within the state and IGST across states', () => {
    const intra = gstBreakdown(69900, { includesGst: true, ratePercent: 18, sellerState: '36' });
    expect(intra).toMatchObject({ taxablePaise: 59237, cgstPaise: 5331, sgstPaise: 5332, igstPaise: 0, totalPaise: 69900, placeOfSupply: '36' });
    const inter = gstBreakdown(69900, { includesGst: true, ratePercent: 18, sellerState: '36', buyerState: '29' });
    expect(inter).toMatchObject({ igstPaise: 10663, cgstPaise: 0, sgstPaise: 0, placeOfSupply: '29' });
    expect(gstBreakdown(10000, { includesGst: false, ratePercent: 18, sellerState: '36' })).toMatchObject({ taxablePaise: 10000, totalPaise: 11800 });
  });

  it('numbers invoices per Indian financial year within 16 characters', () => {
    expect(financialYear(new Date('2026-11-14T10:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2027-03-31T17:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2027-03-31T19:00:00Z'))).toBe('2027-28'); // already 1 April in India
    const no = invoiceNumber('SIS', '2026-27', 1);
    expect(no).toBe('SIS2627-000001');
    expect(no.length).toBeLessThanOrEqual(16);
  });
});

describe('billing basics', () => {
  it('says honestly when payments aren’t configured', async () => {
    const { auth } = await buyer();
    setPaymentProvider(null);
    const b = (await request(app).get('/api/billing').set(auth).expect(200)).body.data;
    expect(b).toMatchObject({ configured: false, plan: 'free', pricesIncludeGst: true });
    expect(b.packs).toHaveLength(4);
    expect((await request(app).post('/api/billing/orders').set(auth).send({ packId: 'pack_10' }).expect(503)).body.error.code).toBe('NOT_CONFIGURED');
    expect((await request(app).get('/api/meta').expect(200)).body.data.features.payments).toBe(false);
  });

  it('validates billing details (GSTIN must match the state)', async () => {
    const { auth } = await buyer();
    await request(app).put('/api/billing/profile').set(auth).send({ legalName: 'Asha Media', gstin: '29ABCDE1234F1Z5', address: 'Bengaluru', stateCode: '36' }).expect(400);
    await request(app).put('/api/billing/profile').set(auth).send({ legalName: 'Asha Media', gstin: 'NOTAGSTIN', address: '', stateCode: '29' }).expect(400);
    const ok = await request(app).put('/api/billing/profile').set(auth).send({ legalName: 'Asha Media', gstin: '29abcde1234f1z5', address: 'Bengaluru', stateCode: '29' }).expect(200);
    expect(ok.body.data.gstin).toBe('29ABCDE1234F1Z5');
  });
});

describe('credit top-ups', () => {
  it('creates an order, verifies the checkout signature and adds credits exactly once with an invoice', async () => {
    const { auth, user, email } = await buyer();
    const balance0 = (await Workspace.findById(user.defaultWorkspaceId))!.creditBalance;
    const order = (await request(app).post('/api/billing/orders').set(auth).send({ packId: 'pack_25' }).expect(201)).body.data;
    expect(order).toMatchObject({ amountPaise: 69900, currency: 'INR', keyId: 'rzp_test_abc', credits: 25 });
    const created = calls.find((c) => c.path === '/orders')!.body as { amount: number; receipt: string; currency: string };
    expect(created).toMatchObject({ amount: 69900, currency: 'INR' });
    expect(created.receipt.length).toBeLessThanOrEqual(40);

    // A forged signature is refused.
    expect((await request(app).post('/api/billing/orders/verify').set(auth).send({ orderId: order.orderId, paymentId: 'pay_X', signature: 'a'.repeat(64) }).expect(400)).body.error.code).toBe('INVALID_SIGNATURE');

    const signature = hmacHex(`${order.orderId}|pay_A1`, KEY_SECRET);
    const ok = (await request(app).post('/api/billing/orders/verify').set(auth).send({ orderId: order.orderId, paymentId: 'pay_A1', signature }).expect(200)).body.data;
    expect(ok).toMatchObject({ credited: true, creditBalance: balance0 + 25 });
    // Verifying again (double click / refresh) never adds credits twice.
    const again = (await request(app).post('/api/billing/orders/verify').set(auth).send({ orderId: order.orderId, paymentId: 'pay_A1', signature }).expect(200)).body.data;
    expect(again).toMatchObject({ credited: false, creditBalance: balance0 + 25 });

    const inv = await Invoice.findOne();
    expect(inv).toMatchObject({ number: 'SIS2627-000001', totalPaise: 69900, taxablePaise: 59237, cgstPaise: 5331, sgstPaise: 5332, sac: '998314' });
    expect(inv!.buyer).toMatchObject({ name: 'Asha Rao', email });
    expect(sentEmails.some((m) => m.to === email && m.tag === 'payment_receipt' && m.text.includes('SIS2627-000001'))).toBe(true);

    const pays = (await request(app).get('/api/billing/payments').set(auth).expect(200)).body.data;
    expect(pays[0]).toMatchObject({ kind: 'credits', status: 'paid', credits: 25 });
    const invs = (await request(app).get('/api/billing/invoices').set(auth).expect(200)).body.data;
    expect(invs[0]).toMatchObject({ number: 'SIS2627-000001', totalPaise: 69900, taxPaise: 10663 });
    const pdf = await request(app).get(`/api/billing/invoices/${invs[0].id}/pdf`).set(auth).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // Other workspaces see nothing.
    const other = await buyer();
    await request(app).post('/api/billing/orders/verify').set(other.auth).send({ orderId: order.orderId, paymentId: 'pay_A1', signature }).expect(404);
    await request(app).get(`/api/billing/invoices/${invs[0].id}/pdf`).set(other.auth).expect(404);
  });

  it('fulfils from webhooks too: signed, deduplicated, never twice', async () => {
    const { auth, user } = await buyer();
    const balance0 = (await Workspace.findById(user.defaultWorkspaceId))!.creditBalance;
    const order = (await request(app).post('/api/billing/orders').set(auth).send({ packId: 'pack_10' }).expect(201)).body.data;
    const captured = { entity: 'event', event: 'payment.captured', payload: { payment: { entity: { id: 'pay_W1', order_id: order.orderId, amount: 29900, status: 'captured' } } } };

    await webhook(captured, 'evt_1', 'wrong-secret').expect(400);
    await webhook(captured, 'evt_1').expect(200);
    await webhook(captured, 'evt_1').expect(200); // redelivery
    await webhook({ ...captured, event: 'order.paid' }, 'evt_2').expect(200); // another event for the same payment
    // The browser's success handler arriving last changes nothing either.
    await request(app).post('/api/billing/orders/verify').set(auth).send({ orderId: order.orderId, paymentId: 'pay_W1', signature: hmacHex(`${order.orderId}|pay_W1`, KEY_SECRET) }).expect(200);
    expect((await Workspace.findById(user.defaultWorkspaceId))!.creditBalance).toBe(balance0 + 10);
    expect(await CreditTransaction.countDocuments({ type: 'purchase' })).toBe(1);
    expect(await Invoice.countDocuments()).toBe(1);

    const order2 = (await request(app).post('/api/billing/orders').set(auth).send({ packId: 'pack_10' }).expect(201)).body.data;
    await webhook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_F', order_id: order2.orderId, error_description: 'Card declined' } } } }, 'evt_3').expect(200);
    expect(await Payment.findOne({ orderId: order2.orderId })).toMatchObject({ status: 'failed', failureReason: 'Card declined' });
  });
});

describe('subscriptions', () => {
  async function subscribe(planId = 'creator', period = 'monthly') {
    const u = await buyer();
    const s = (await request(app).post('/api/billing/subscriptions').set(u.auth).send({ planId, period }).expect(201)).body.data;
    await request(app)
      .post('/api/billing/subscriptions/verify')
      .set(u.auth)
      .send({ subscriptionId: s.subscriptionId, paymentId: 'pay_S1', signature: hmacHex(`pay_S1|${s.subscriptionId}`, KEY_SECRET) })
      .expect(200);
    return { ...u, sub: s };
  }

  it('activates on checkout, renews on each charge, and ends on Free', async () => {
    const { auth, user, sub } = await subscribe();
    const ws = await Workspace.findById(user.defaultWorkspaceId);
    expect(ws!.plan).toBe('creator');
    const plan = calls.find((c) => c.path === '/plans')!.body as { period: string; item: { amount: number } };
    expect(plan).toMatchObject({ period: 'monthly', item: { amount: 99900 } });
    expect(calls.find((c) => c.path === '/subscriptions')!.body).toMatchObject({ total_count: 120 });
    const afterFirst = ws!.creditBalance;

    // The subscription signature uses payment_id|subscription_id — the order-style signature is refused.
    await request(app).post('/api/billing/subscriptions/verify').set(auth).send({ subscriptionId: sub.subscriptionId, paymentId: 'pay_S1', signature: hmacHex(`${sub.subscriptionId}|pay_S1`, KEY_SECRET) }).expect(400);

    const entity = { id: sub.subscriptionId, status: 'active', plan_id: 'plan_T1', current_start: 1_800_000_000, current_end: 1_802_592_000 };
    // First-charge webhook for the payment already verified: no double credits.
    await webhook({ event: 'subscription.charged', payload: { subscription: { entity }, payment: { entity: { id: 'pay_S1', amount: 99900 } } } }, 'e1').expect(200);
    // Renewal next month.
    await webhook({ event: 'subscription.charged', payload: { subscription: { entity }, payment: { entity: { id: 'pay_S2', amount: 99900 } } } }, 'e2').expect(200);
    await webhook({ event: 'subscription.charged', payload: { subscription: { entity }, payment: { entity: { id: 'pay_S2', amount: 99900 } } } }, 'e2b').expect(200);
    const ws2 = await Workspace.findById(user.defaultWorkspaceId);
    expect(ws2!.creditBalance).toBe(afterFirst + 50);
    expect(await Invoice.countDocuments()).toBe(2);
    const b = (await request(app).get('/api/billing').set(auth).expect(200)).body.data;
    expect(b.subscription).toMatchObject({ planId: 'creator', period: 'monthly', status: 'active' });
    expect(new Date(b.subscription.currentEnd).getTime()).toBe(1_802_592_000_000);

    await request(app).post('/api/billing/subscriptions/cancel').set(auth).expect(200);
    expect(calls.at(-1)).toMatchObject({ path: `/subscriptions/${sub.subscriptionId}/cancel`, body: { cancel_at_cycle_end: true } });
    expect((await Workspace.findById(user.defaultWorkspaceId))!.plan).toBe('creator'); // until the cycle ends
    await webhook({ event: 'subscription.cancelled', payload: { subscription: { entity: { ...entity, status: 'cancelled' } } } }, 'e3').expect(200);
    expect((await Workspace.findById(user.defaultWorkspaceId))!.plan).toBe('free');
  });

  it('upgrades now (extra credits) and downgrades at the end of the cycle', async () => {
    const { auth, user, sub } = await subscribe('creator', 'monthly');
    const before = (await Workspace.findById(user.defaultWorkspaceId))!.creditBalance;
    const up = (await request(app).post('/api/billing/subscriptions/change').set(auth).send({ planId: 'pro' }).expect(200)).body.data;
    expect(up).toMatchObject({ upgrade: true, planId: 'pro' });
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', body: { schedule_change_at: 'now' } });
    const ws = await Workspace.findById(user.defaultWorkspaceId);
    expect(ws).toMatchObject({ plan: 'pro', creditBalance: before + 70 }); // 120 − 50

    const down = (await request(app).post('/api/billing/subscriptions/change').set(auth).send({ planId: 'starter' }).expect(200)).body.data;
    expect(down).toMatchObject({ upgrade: false, scheduledPlanId: 'starter' });
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', body: { schedule_change_at: 'cycle_end' } });
    expect((await Workspace.findById(user.defaultWorkspaceId))!.plan).toBe('pro');
    // At the cycle end Razorpay reports the new plan with the renewal.
    const sp = await ProviderPlan.findOne({ key: /^starter:monthly/ });
    await webhook({ event: 'subscription.charged', payload: { subscription: { entity: { id: sub.subscriptionId, status: 'active', plan_id: sp!.providerPlanId } }, payment: { entity: { id: 'pay_D1', amount: 49900 } } } }, 'd1').expect(200);
    expect((await Workspace.findById(user.defaultWorkspaceId))!.plan).toBe('starter');
    expect(await Subscription.findOne({ providerSubscriptionId: sub.subscriptionId })).toMatchObject({ planId: 'starter', scheduledPlanId: null });

    failNext = new PaymentError('Razorpay: subscriptions cannot be updated when payment mode is UPI', 400);
    expect((await request(app).post('/api/billing/subscriptions/change').set(auth).send({ planId: 'agency' }).expect(409)).body.error.code).toBe('PLAN_CHANGE_UNSUPPORTED');
  });

  it('bills annual plans yearly with a year of credits, IGST for another state, and blocks double subscriptions', async () => {
    const u = await buyer();
    await request(app).put('/api/billing/profile').set(u.auth).send({ legalName: 'Asha Media', gstin: '29ABCDE1234F1Z5', address: 'Bengaluru', stateCode: '29' }).expect(200);
    const s = (await request(app).post('/api/billing/subscriptions').set(u.auth).send({ planId: 'starter', period: 'yearly' }).expect(201)).body.data;
    expect(calls.find((c) => c.path === '/subscriptions')!.body).toMatchObject({ total_count: 10 });
    const before = (await Workspace.findById(u.user.defaultWorkspaceId))!.creditBalance;
    await request(app).post('/api/billing/subscriptions/verify').set(u.auth).send({ subscriptionId: s.subscriptionId, paymentId: 'pay_Y1', signature: hmacHex(`pay_Y1|${s.subscriptionId}`, KEY_SECRET) }).expect(200);
    expect((await Workspace.findById(u.user.defaultWorkspaceId))!.creditBalance).toBe(before + 240);
    const inv = await Invoice.findOne();
    expect(inv).toMatchObject({ totalPaise: 499000, igstPaise: 76119, cgstPaise: 0, placeOfSupply: '29' });
    expect(inv!.buyer).toMatchObject({ gstin: '29ABCDE1234F1Z5', name: 'Asha Media' });
    expect((await request(app).post('/api/billing/subscriptions').set(u.auth).send({ planId: 'pro', period: 'monthly' }).expect(409)).body.error.code).toBe('ALREADY_SUBSCRIBED');
  });
});
