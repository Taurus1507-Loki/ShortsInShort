import { Schema, model, type HydratedDocument, type InferSchemaType, Types } from 'mongoose';
import { PLAN_IDS } from '../config/plans.js';

/** One checkout attempt: a credit top-up order or a subscription charge. Fulfilled at most once. */
const paymentSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    kind: { type: String, enum: ['credits', 'subscription'], required: true },
    provider: { type: String, default: 'razorpay' },
    orderId: { type: String, default: null },
    paymentId: { type: String, default: null },
    subscriptionId: { type: String, default: null },
    amountPaise: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['created', 'paid', 'failed'], default: 'created' },
    packId: { type: String, default: null },
    planId: { type: String, enum: [...PLAN_IDS, null], default: null },
    period: { type: String, enum: ['monthly', 'yearly', null], default: null },
    credits: { type: Number, default: 0 },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
    failureReason: { type: String, default: null, maxlength: 300 },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);
paymentSchema.index({ orderId: 1 }, { unique: true, partialFilterExpression: { orderId: { $type: 'string' } } });
paymentSchema.index({ paymentId: 1 }, { unique: true, partialFilterExpression: { paymentId: { $type: 'string' } } });
paymentSchema.index({ workspaceId: 1, createdAt: -1 });
export type PaymentDoc = HydratedDocument<InferSchemaType<typeof paymentSchema>>;
export const Payment = model('Payment', paymentSchema);

/** A workspace's recurring plan, mirroring the Razorpay subscription. */
const subscriptionSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    providerSubscriptionId: { type: String, required: true },
    providerPlanId: { type: String, required: true },
    planId: { type: String, enum: PLAN_IDS, required: true },
    period: { type: String, enum: ['monthly', 'yearly'], required: true },
    /** Razorpay status: created, authenticated, active, pending, halted, cancelled, completed, expired, paused. */
    status: { type: String, required: true },
    currentStart: { type: Date, default: null },
    currentEnd: { type: Date, default: null },
    cancelAtCycleEnd: { type: Boolean, default: false },
    /** A downgrade waiting for the end of the cycle. */
    scheduledPlanId: { type: String, enum: [...PLAN_IDS, null], default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
subscriptionSchema.index({ providerSubscriptionId: 1 }, { unique: true });
subscriptionSchema.index({ workspaceId: 1, createdAt: -1 });
export type SubscriptionDoc = HydratedDocument<InferSchemaType<typeof subscriptionSchema>>;
export const Subscription = model('Subscription', subscriptionSchema);
/** Statuses during which the workspace is on a paid subscription. */
export const LIVE_SUBSCRIPTION_STATUSES = ['created', 'authenticated', 'active', 'pending', 'halted', 'paused'];

/** Razorpay plan ids created on demand, one per (our plan, period, price). */
const providerPlanSchema = new Schema({ key: { type: String, required: true }, providerPlanId: { type: String, required: true } }, { timestamps: true });
providerPlanSchema.index({ key: 1 }, { unique: true });
export const ProviderPlan = model('ProviderPlan', providerPlanSchema);

/** Webhook deliveries seen, keyed by x-razorpay-event-id, so a redelivery is processed once. */
const webhookEventSchema = new Schema(
  {
    eventId: { type: String, required: true },
    event: { type: String, required: true },
    processedAt: { type: Date, default: null },
    error: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true },
);
webhookEventSchema.index({ eventId: 1 }, { unique: true });
webhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
export const WebhookEvent = model('WebhookEvent', webhookEventSchema);

/** GST tax invoice (immutable once issued). Amounts in paise. */
const invoiceSchema = new Schema(
  {
    number: { type: String, required: true },
    financialYear: { type: String, required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    providerPaymentId: { type: String, default: null },
    issuedAt: { type: Date, required: true },
    seller: { legalName: String, gstin: String, address: String, stateCode: String },
    buyer: { name: String, email: String, gstin: String, address: String, stateCode: String },
    placeOfSupply: { type: String, required: true },
    sac: { type: String, required: true },
    lines: { type: [{ _id: false, description: String, quantity: Number, amountPaise: Number }], default: [] },
    taxablePaise: { type: Number, required: true },
    cgstPaise: { type: Number, default: 0 },
    sgstPaise: { type: Number, default: 0 },
    igstPaise: { type: Number, default: 0 },
    gstRate: { type: Number, required: true },
    totalPaise: { type: Number, required: true },
  },
  { timestamps: true },
);
invoiceSchema.index({ number: 1 }, { unique: true });
invoiceSchema.index({ paymentId: 1 }, { unique: true });
invoiceSchema.index({ workspaceId: 1, issuedAt: -1 });
export type InvoiceDoc = HydratedDocument<InferSchemaType<typeof invoiceSchema>>;
export const Invoice = model('Invoice', invoiceSchema);

/** Gap-free invoice numbering per financial year. */
const counterSchema = new Schema({ key: { type: String, required: true }, seq: { type: Number, default: 0 } });
counterSchema.index({ key: 1 }, { unique: true });
export const Counter = model('Counter', counterSchema);

export function toPublicPayment(p: PaymentDoc) {
  return {
    id: (p._id as Types.ObjectId).toString(),
    kind: p.kind,
    status: p.status,
    amountPaise: p.amountPaise,
    credits: p.credits,
    packId: p.packId,
    planId: p.planId,
    period: p.period,
    invoiceId: p.invoiceId?.toString() ?? null,
    failureReason: p.failureReason,
    paidAt: p.paidAt,
    createdAt: p.get('createdAt') as Date,
  };
}

export function toPublicInvoice(i: InvoiceDoc) {
  return {
    id: (i._id as Types.ObjectId).toString(),
    number: i.number,
    issuedAt: i.issuedAt,
    description: i.lines[0]?.description ?? '',
    taxablePaise: i.taxablePaise,
    taxPaise: i.cgstPaise + i.sgstPaise + i.igstPaise,
    totalPaise: i.totalPaise,
    buyerGstin: i.buyer?.gstin || null,
  };
}
