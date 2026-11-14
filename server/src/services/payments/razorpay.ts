import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

export class PaymentError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export type Http = (method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) => Promise<unknown>;

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
}

/** Hex HMAC-SHA256. Exported for tests. */
export const hmacHex = (message: string, secret: string) => createHmac('sha256', secret).update(message).digest('hex');

/** Constant-time comparison of two hex signatures. */
function sameSignature(expected: string, given: string): boolean {
  if (typeof given !== 'string' || !/^[0-9a-f]{64}$/i.test(given)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given.toLowerCase(), 'hex'));
}

/**
 * Razorpay REST API (https://api.razorpay.com/v1, HTTP Basic key_id:key_secret).
 * REQUIRES `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`. The HTTP function is injectable for tests.
 */
export class RazorpayProvider {
  readonly name = 'razorpay';
  constructor(
    readonly config: RazorpayConfig,
    private readonly http: Http = defaultHttp(config),
  ) {}

  get keyId() {
    return this.config.keyId;
  }

  createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
    return this.http('POST', '/orders', { amount: input.amountPaise, currency: 'INR', receipt: input.receipt.slice(0, 40), notes: input.notes }) as Promise<{ id: string; amount: number; status: string }>;
  }

  createPlan(input: { period: 'monthly' | 'yearly'; name: string; amountPaise: number; notes: Record<string, string> }) {
    return this.http('POST', '/plans', { period: input.period, interval: 1, item: { name: input.name, amount: input.amountPaise, currency: 'INR' }, notes: input.notes }) as Promise<{ id: string }>;
  }

  createSubscription(input: { planId: string; totalCount: number; notes: Record<string, string> }) {
    return this.http('POST', '/subscriptions', { plan_id: input.planId, total_count: input.totalCount, customer_notify: true, notes: input.notes }) as Promise<{ id: string; status: string; short_url?: string }>;
  }

  cancelSubscription(id: string, atCycleEnd: boolean) {
    return this.http('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd }) as Promise<{ id: string; status: string }>;
  }

  updateSubscription(id: string, input: { planId: string; when: 'now' | 'cycle_end' }) {
    return this.http('PATCH', `/subscriptions/${encodeURIComponent(id)}`, { plan_id: input.planId, schedule_change_at: input.when, customer_notify: true }) as Promise<{ id: string; plan_id: string; status: string }>;
  }

  /** Checkout success for an order: HMAC_SHA256(order_id + "|" + payment_id) with the key secret. */
  verifyOrderPayment(orderId: string, paymentId: string, signature: string): boolean {
    return sameSignature(hmacHex(`${orderId}|${paymentId}`, this.config.keySecret), signature);
  }

  /** Checkout success for a subscription: HMAC_SHA256(payment_id + "|" + subscription_id) — note the order. */
  verifySubscriptionPayment(subscriptionId: string, paymentId: string, signature: string): boolean {
    return sameSignature(hmacHex(`${paymentId}|${subscriptionId}`, this.config.keySecret), signature);
  }

  /** Webhook: HMAC_SHA256 of the raw body with the webhook secret (not the key secret). */
  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!this.config.webhookSecret || !signature) return false;
    return sameSignature(hmacHex(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'), this.config.webhookSecret), signature);
  }
}

function defaultHttp(config: RazorpayConfig): Http {
  const auth = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;
  return async (method, path, body) => {
    let res: Response;
    try {
      res = await fetch(`https://api.razorpay.com/v1${path}`, {
        method,
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new PaymentError('Could not reach Razorpay. Try again shortly.', 502);
    }
    const text = await res.text();
    if (!res.ok) {
      let description = '';
      let code = '';
      try {
        const j = JSON.parse(text) as { error?: { code?: string; description?: string } };
        description = j.error?.description ?? '';
        code = j.error?.code ?? '';
      } catch {
        /* not JSON */
      }
      if (res.status === 401) throw new PaymentError('Razorpay rejected the API keys.', 401, code);
      throw new PaymentError(description ? `Razorpay: ${description}` : `Razorpay request failed (HTTP ${res.status}).`, res.status, code);
    }
    return JSON.parse(text) as unknown;
  };
}

let override: RazorpayProvider | null | undefined;
/** Test seam: inject a provider (null = not configured, undefined = from env). */
export function setPaymentProvider(p: RazorpayProvider | null | undefined) {
  override = p;
}
export function getPaymentProvider(): RazorpayProvider | null {
  if (override !== undefined) return override;
  const c = env.payments.razorpay;
  return c ? new RazorpayProvider(c) : null;
}
