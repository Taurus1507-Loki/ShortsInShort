import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CreditCard, Download, Receipt, ShieldCheck, Zap } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Notice, Skeleton } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/overlays';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, downloadFile, errorMessage } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import { cn, formatInr } from '@/lib/utils';

interface BillingInfo {
  configured: boolean;
  keyId: string | null;
  pricesIncludeGst: boolean;
  gstRate: number;
  plan: string;
  plans: Array<{ id: string; name: string; monthlyPaise: number; yearlyPaise: number; monthlyCredits: number; yearlyCredits: number }>;
  packs: Array<{ id: string; credits: number; pricePaise: number }>;
  subscription: { planId: string; period: 'monthly' | 'yearly'; status: string; currentEnd: string | null; cancelAtCycleEnd: boolean; scheduledPlanId: string | null } | null;
  billing: { legalName: string; gstin: string; address: string; stateCode: string };
}
interface InvoiceRow {
  id: string;
  number: string;
  issuedAt: string;
  description: string;
  totalPaise: number;
  taxPaise: number;
}

const STATES: Array<[string, string]> = [
  ['37', 'Andhra Pradesh'], ['18', 'Assam'], ['10', 'Bihar'], ['04', 'Chandigarh'], ['22', 'Chhattisgarh'], ['07', 'Delhi'], ['30', 'Goa'],
  ['24', 'Gujarat'], ['06', 'Haryana'], ['02', 'Himachal Pradesh'], ['01', 'Jammu & Kashmir'], ['20', 'Jharkhand'], ['29', 'Karnataka'],
  ['32', 'Kerala'], ['23', 'Madhya Pradesh'], ['27', 'Maharashtra'], ['21', 'Odisha'], ['34', 'Puducherry'], ['03', 'Punjab'], ['08', 'Rajasthan'],
  ['33', 'Tamil Nadu'], ['36', 'Telangana'], ['09', 'Uttar Pradesh'], ['05', 'Uttarakhand'], ['19', 'West Bengal'],
];
const RANK: Record<string, number> = { free: 0, starter: 1, creator: 2, pro: 3, agency: 4 };

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (e: string, fn: (r: { error?: { description?: string } }) => void) => void };
  }
}

/** Loads Razorpay Standard Checkout once. */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay Checkout. Check your connection and try again.'));
    document.body.appendChild(s);
  });
}

/** Opens Checkout; resolves with Razorpay's success fields, or null if the person closed it. */
async function openCheckout(options: Record<string, unknown>): Promise<Record<string, string> | null> {
  await loadCheckout();
  return new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      ...options,
      theme: { color: '#7C3AED' },
      handler: (r: Record<string, string>) => resolve(r),
      modal: { ondismiss: () => resolve(null) },
    });
    rzp.on('payment.failed', (r) => toast.error(r.error?.description ?? 'Payment failed. You were not charged.'));
    rzp.open();
  });
}

const useBilling = () => useQuery({ queryKey: ['billing'], queryFn: () => api<{ data: BillingInfo }>('/billing').then((r) => r.data) });
const useInvoices = () => useQuery({ queryKey: ['billing', 'invoices'], queryFn: () => api<{ data: InvoiceRow[] }>('/billing/invoices').then((r) => r.data) });

function refreshAll() {
  queryClient.invalidateQueries({ queryKey: ['billing'] });
  queryClient.invalidateQueries({ queryKey: keys.me });
  queryClient.invalidateQueries({ queryKey: keys.dashboard });
}

export default function BillingPage() {
  const { workspace } = useAuth();
  const { data: b, isLoading } = useBilling();
  const { data: invoices } = useInvoices();
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const sub = b?.subscription;
  const live = sub && ['active', 'authenticated', 'pending', 'halted'].includes(sub.status);

  const buyPack = useMutation({
    mutationFn: async (packId: string) => {
      const o = (await api<{ data: { orderId: string; amountPaise: number; keyId: string; credits: number; prefill: Record<string, string> } }>('/billing/orders', { method: 'POST', body: { packId } })).data;
      const r = await openCheckout({ key: o.keyId, amount: o.amountPaise, currency: 'INR', name: 'ShortsInShort', description: `${o.credits} credits`, order_id: o.orderId, prefill: o.prefill });
      if (!r) return null;
      return api<{ data: { creditBalance: number } }>('/billing/orders/verify', { method: 'POST', body: { orderId: o.orderId, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } }).then((x) => x.data);
    },
    onSuccess: (r) => {
      if (!r) return;
      toast.success(`Payment received — you now have ${r.creditBalance} credits`);
      refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const subscribe = useMutation({
    mutationFn: async (planId: string) => {
      const s = (await api<{ data: { subscriptionId: string; keyId: string; prefill: Record<string, string> } }>('/billing/subscriptions', { method: 'POST', body: { planId, period } })).data;
      const r = await openCheckout({ key: s.keyId, subscription_id: s.subscriptionId, name: 'ShortsInShort', description: `${planId} plan (${period})`, prefill: s.prefill });
      if (!r) return null;
      return api<{ data: { plan: string } }>('/billing/subscriptions/verify', { method: 'POST', body: { subscriptionId: s.subscriptionId, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } }).then((x) => x.data);
    },
    onSuccess: (r) => {
      if (!r) return;
      toast.success('Subscription active — your credits were added');
      refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const change = useMutation({
    mutationFn: (planId: string) => api<{ data: { upgrade: boolean } }>('/billing/subscriptions/change', { method: 'POST', body: { planId } }).then((r) => r.data),
    onSuccess: (r) => {
      toast.success(r.upgrade ? 'Upgraded — extra credits added' : 'Downgrade scheduled for the end of this billing period');
      refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const cancel = useMutation({
    mutationFn: () => api('/billing/subscriptions/cancel', { method: 'POST' }),
    onSuccess: () => {
      toast.success('Subscription will end at the end of this billing period');
      setConfirmCancel(false);
      refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const busy = buyPack.isPending || subscribe.isPending || change.isPending;
  const endDate = sub?.currentEnd ? new Date(sub.currentEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Subscription & Billing" description="Your plan, credits, top-ups and GST invoices." />
      {b && !b.configured && (
        <Notice tone="info" title="Online payments aren’t switched on yet" className="mb-6">
          Razorpay keys aren’t configured on this server, so plans and credits can’t be bought yet. Nothing is charged and no card details are collected.
        </Notice>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Current plan</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {!b || !workspace ? (
              <Skeleton className="h-24" />
            ) : (
              <>
                <p className="font-display text-3xl font-extrabold capitalize">{b.plan}</p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Credits available</span>
                  <span className="font-semibold">{workspace.creditBalance}</span>
                </div>
                {live && sub && (
                  <>
                    <p className="text-muted-foreground">
                      {sub.period === 'yearly' ? 'Yearly' : 'Monthly'} ·{' '}
                      {sub.cancelAtCycleEnd ? `ends ${endDate ?? 'at the end of this period'}` : endDate ? `renews ${endDate}` : 'active'}
                    </p>
                    {sub.scheduledPlanId && <p className="text-xs text-muted-foreground">Moves to {sub.scheduledPlanId} at the next renewal.</p>}
                    {['pending', 'halted'].includes(sub.status) && <Notice tone="warning">Your last payment didn’t go through. Razorpay will retry; update your payment method from the Razorpay email if it keeps failing.</Notice>}
                    {!sub.cancelAtCycleEnd && (
                      <Button variant="ghost" size="sm" className="justify-self-start px-0 text-muted-foreground" onClick={() => setConfirmCancel(true)}>
                        Cancel subscription
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" /> Buy credits
            </CardTitle>
            <CardDescription>One-time top-ups that never expire. Plans are cheaper per credit.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(b?.packs ?? []).map((p) => (
              <div key={p.id} className="grid gap-2 rounded-lg border border-border p-3 text-center">
                <p className="font-display text-2xl font-extrabold">{p.credits}</p>
                <p className="text-xs text-muted-foreground">credits</p>
                <p className="font-semibold">{formatInr(p.pricePaise)}</p>
                <Button size="sm" variant="outline" disabled={!b?.configured || busy} loading={buyPack.isPending && buyPack.variables === p.id} onClick={() => buyPack.mutate(p.id)}>
                  Buy
                </Button>
              </div>
            ))}
            {isLoading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32" />)}
          </CardContent>
        </Card>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Plans</h2>
        <div className="flex rounded-lg border border-border p-0.5 text-sm" role="radiogroup" aria-label="Billing period">
          {(['monthly', 'yearly'] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={period === p} onClick={() => setPeriod(p)} className={cn('rounded-md px-3 py-1.5', period === p ? 'bg-primary text-white' : 'text-muted-foreground')}>
              {p === 'monthly' ? 'Monthly' : 'Yearly (2 months free)'}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(b?.plans ?? []).map((p) => {
          const current = live && sub?.planId === p.id;
          const price = period === 'yearly' ? p.yearlyPaise : p.monthlyPaise;
          let action: { label: string; onClick?: () => void; disabled?: boolean } = { label: 'Subscribe', onClick: () => subscribe.mutate(p.id) };
          if (current) action = { label: 'Your plan', disabled: true };
          else if (live && sub) {
            if (sub.period !== period) action = { label: `Switch to ${period} after cancelling`, disabled: true };
            else action = { label: RANK[p.id]! > RANK[sub.planId]! ? 'Upgrade now' : 'Downgrade at renewal', onClick: () => change.mutate(p.id) };
          }
          return (
            <Card key={p.id} className={cn('flex flex-col p-5', current && 'border-primary/60')}>
              <div className="flex items-center justify-between">
                <p className="font-semibold">{p.name}</p>
                {current && <Badge>Current</Badge>}
              </div>
              <p className="mt-3 font-display text-2xl font-extrabold">
                {formatInr(price)}
                <span className="text-sm font-normal text-muted-foreground">/{period === 'yearly' ? 'yr' : 'mo'}</span>
              </p>
              <p className="mt-1 text-sm text-highlight">{period === 'yearly' ? `${p.yearlyCredits} credits a year` : `${p.monthlyCredits} credits a month`}</p>
              <Button className="mt-5" size="sm" variant={current ? 'secondary' : 'gradient'} disabled={!b?.configured || busy || action.disabled} onClick={action.onClick}>
                {action.label}
              </Button>
            </Card>
          );
        })}
      </div>
      {b && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Secure payments by Razorpay (cards, UPI, net banking). Prices {b.pricesIncludeGst ? `include ${b.gstRate}% GST` : `exclude ${b.gstRate}% GST`}. Cancel any time — your plan stays until the period ends.
        </p>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {b && <BillingDetails initial={b.billing} />}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" /> Invoices
            </CardTitle>
            <CardDescription>GST tax invoices for every payment.</CardDescription>
          </CardHeader>
          <CardContent>
            {!invoices?.length ? (
              <p className="text-sm text-muted-foreground">No invoices yet.</p>
            ) : (
              <ul className="grid gap-2">
                {invoices.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{inv.number}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {new Date(inv.issuedAt).toLocaleDateString('en-IN')} · {inv.description}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold">{formatInr(inv.totalPaise)}</span>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Download ${inv.number}`} onClick={() => downloadFile(`/billing/invoices/${inv.id}/pdf`, `${inv.number}.pdf`).catch((e) => toast.error(errorMessage(e)))}>
                      <Download />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">Cancel your subscription?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            You keep your plan and credits until {endDate ?? 'the end of this billing period'}. After that the workspace moves to Free. No refund is made for the current period.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
              Keep subscription
            </Button>
            <Button variant="destructive" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel at period end
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Name, GSTIN, state and address printed on invoices; the state decides CGST+SGST vs IGST. */
function BillingDetails({ initial }: { initial: BillingInfo['billing'] }) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  const save = useMutation({
    mutationFn: () => api('/billing/profile', { method: 'PUT', body: { ...v, gstin: v.gstin.trim().toUpperCase() } }),
    onSuccess: () => {
      toast.success('Billing details saved — used on your next invoice');
      queryClient.invalidateQueries({ queryKey: ['billing'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" /> Billing details
        </CardTitle>
        <CardDescription>Shown on invoices. Add a GSTIN to claim input tax credit as a business.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field id="b-name" label="Name or company">
          <Input value={v.legalName} maxLength={120} onChange={(e) => setV({ ...v, legalName: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="b-state" label="State" hint="Decides CGST + SGST or IGST.">
            <Select value={v.stateCode} onChange={(e) => setV({ ...v, stateCode: e.target.value })}>
              <option value="">Not specified</option>
              {STATES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="b-gstin" label="GSTIN (optional)">
            <Input value={v.gstin} maxLength={15} onChange={(e) => setV({ ...v, gstin: e.target.value.toUpperCase() })} placeholder="e.g. 36ABCDE1234F1Z5" />
          </Field>
        </div>
        <Field id="b-address" label="Address (optional)">
          <Input value={v.address} maxLength={300} onChange={(e) => setV({ ...v, address: e.target.value })} />
        </Field>
        <Button size="sm" className="justify-self-start" onClick={() => save.mutate()} loading={save.isPending}>
          Save details
        </Button>
      </CardContent>
    </Card>
  );
}
