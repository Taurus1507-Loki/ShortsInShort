# Phase 5 — Payments (Razorpay), subscriptions & GST invoices

Goal: customers buy plans and credit top-ups in INR with Razorpay; credits and plan changes are applied
exactly once, even with retries and out-of-order webhooks; every payment gets a GST-compliant invoice.

## Steps

| Step | Scope |
|---|---|
| **5.1 Credit top-ups + payment infrastructure** | Razorpay adapter (Orders API, Basic auth), credit packs, Standard Checkout on the Billing page, server-side signature check (`HMAC_SHA256(order_id + "|" + payment_id, key_secret)` with the server's own order id), webhooks (`X-Razorpay-Signature` over the raw body, dedupe by `x-razorpay-event-id`, idempotent fulfilment), payments history. |
| **5.2 Subscriptions** | Razorpay plans created on demand per plan × period, subscriptions with Checkout (`HMAC_SHA256(payment_id + "|" + subscription_id, key_secret)`), plan + credits on activation and on every renewal (`subscription.charged`), cancel at cycle end, upgrade now / downgrade at cycle end, past-due / halted handling, downgrade to Free when a subscription ends. |
| **5.3 GST invoices** | Sequential numbers per financial year (≤16 chars, e.g. `SIS2627-000001`), seller/buyer details (optional GSTIN for business buyers), CGST+SGST (same state) or IGST (other state), SAC code, PDF download, invoice email. |

## Decisions (defaults — change in `server/.env`)
- **Prices include GST** (`PRICES_INCLUDE_GST=true`, 18%): ₹499 = ₹422.88 + ₹76.12 GST. Set `false` to add GST on top.
- **Annual plans** grant 12 months of credits at each yearly charge.
- **Credit packs** (assumption): 10 credits ₹299 · 25 ₹699 · 60 ₹1,499 · 150 ₹3,499 (GST incl.) — subscriptions stay
  cheaper per credit.
- **Upgrades** apply immediately (Razorpay `schedule_change_at: now`, difference in monthly credits granted at once);
  **downgrades** at the end of the cycle. UPI/e-mandate subscriptions can't be changed by Razorpay — the app says
  so and offers cancel + resubscribe.
- **SAC code** defaults to 998314 — confirm with your CA (`BILLING_SAC`).

## What you'll need to provide
- Razorpay **test** keys first (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`), a webhook secret (`RAZORPAY_WEBHOOK_SECRET`)
  and a public HTTPS webhook URL (Razorpay rejects localhost/ngrok) → `/api/billing/webhook`, events: payment.captured,
  payment.failed, order.paid, subscription.*. Enable auto-capture in the Razorpay Dashboard.
- Seller details for invoices: legal name, GSTIN, registered address, state code (`BILLING_*`).
- Live keys only after test-mode checks pass.

## What's built (2026-11-14)

All three steps are built and tested against a stand-in for Razorpay's servers (real signature checks).
**Not yet run against Razorpay test mode** — needs your test keys and a public webhook URL.

- **Adapter** `services/payments/razorpay.ts`: orders, plans, subscriptions, cancel, update; constant-time checks of
  the two Checkout signatures (order: `order_id|payment_id`; subscription: `payment_id|subscription_id`, both with
  the key secret, using the server's own ids) and the webhook signature (raw body, webhook secret).
- **Top-ups** (`/api/billing/orders`, `/orders/verify`): a Payment record first, its id as Razorpay's `receipt`
  (Razorpay rejects duplicate receipts), credits granted with ledger key `purchase:<payment>` — Checkout success,
  `payment.captured` and `order.paid` all converge on the same once-only fulfilment. `payment.failed` is recorded.
- **Subscriptions** (`/subscriptions`, `/verify`, `/cancel`, `/change`): Razorpay plans created on demand and
  remembered per plan × period × price; first charge on checkout, renewals on `subscription.charged` (ledger key
  `subcharge:<payment>`, so the first charge's webhook doesn't credit twice); annual = 12 months of credits per
  yearly charge; cancel at cycle end → Free when Razorpay sends `subscription.cancelled`/`completed`/`expired`;
  upgrades now with the extra credits, downgrades scheduled and applied when Razorpay reports the new plan; UPI /
  e-mandate subscriptions that Razorpay can't change get a clear "cancel and resubscribe" message.
- **Webhook** `POST /api/billing/webhook`: mounted before the JSON parser (raw bytes) and the origin check;
  each `x-razorpay-event-id` processed once (stored 90 days); failures answer 500 so Razorpay retries.
- **GST invoices**: numbers like `SIS2627-000001` (≤16 chars, gap-free per financial year via an atomic counter,
  financial year by Indian time), seller details from `BILLING_*`, buyer name/GSTIN/state/address from the
  workspace's billing details (GSTIN format and state match validated), CGST+SGST vs IGST by place of supply,
  SAC code, exact paise rounding, PDF download (pdfkit), receipt email with the invoice number.
- **Billing page**: plan + renewal/cancellation status, credit packs, monthly/yearly plans with Subscribe /
  Upgrade now / Downgrade at renewal, cancel dialog, billing details form, invoice list with PDF download, and an
  honest "payments aren't switched on" notice without keys. Checked in the browser (2026-11-14).
- **Tests:** 9 (`billing.test.ts`): GST maths and numbering, not-configured state, profile validation, top-up with
  forged/valid signatures and double verification, webhooks (bad signature, redelivery, order.paid after
  payment.captured, payment.failed), subscription activation/renewal/cancel → Free, upgrade/downgrade/UPI refusal,
  annual credits + IGST for an out-of-state business buyer, double-subscription guard.
- **Test environment note:** Windows' application-control policy now blocks launching `mongod.exe` from the test
  runner, so tests fall back to a dedicated `shortsinshort_test` database on the running MongoDB service (the
  name must contain "test"; override with `TEST_MONGODB_URI`).

## Before going live
1. Razorpay test mode: keys in `server/.env`, enable auto-capture, add the webhook (public HTTPS URL) with the events
   above, buy a pack with card 4100 2800 0000 1007 / UPI success@razorpay, subscribe with a subscription test card
   (e.g. 4718 6091 0820 4366), cancel, change plan — confirm credits, invoices and emails.
2. Fill `BILLING_LEGAL_NAME`, `BILLING_GSTIN`, `BILLING_ADDRESS`, `BILLING_STATE_CODE`; have a CA confirm the SAC
   code, the GST-inclusive pricing and the invoice format.
3. Switch to live keys.

