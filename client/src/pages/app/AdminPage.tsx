import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge, Card, Notice, Skeleton } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/overlays';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import { cn, formatBytes, formatInr } from '@/lib/utils';

type Tab = 'overview' | 'users' | 'jobs' | 'payments' | 'voices' | 'audit';
const TABS: Array<[Tab, string]> = [
  ['overview', 'Overview'],
  ['users', 'Users'],
  ['jobs', 'Failed jobs'],
  ['payments', 'Payments'],
  ['voices', 'Voice consents'],
  ['audit', 'Audit log'],
];
const when = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const useAdmin = <T,>(key: unknown[], path: string) => useQuery({ queryKey: ['admin', ...key], queryFn: () => api<{ data: T; meta?: { total: number } }>(path) });

/** Admin console: product health, users, failed jobs, payments, voice consents and the audit log. */
export default function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  if (user && user.role !== 'admin' && user.role !== 'super_admin') {
    return <Notice tone="error" title="Admins only">You don’t have access to the admin console.</Notice>;
  }
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Admin" description="Product health, users and operations. Every change you make here is recorded in the audit log." />
      <div className="mb-6 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'jobs' && <Jobs />}
      {tab === 'payments' && <Payments />}
      {tab === 'voices' && <Voices />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

/* ── Overview ── */

interface OverviewData {
  users: { total: number; verified: number; suspended: number; signups7: number; signups30: number };
  plans: Record<string, number>;
  subscriptions: { active: number };
  revenue: { last30Paise: number; payments30: number; monthPaise: number };
  credits30: Record<string, number>;
  projects: Record<string, number>;
  jobs30: { completed: number; failed: number; failureRate: number };
  queue: Record<string, number>;
  storageBytes: number;
  failedWebhooks: number;
}
interface DayPoint {
  day: string;
  signups: number;
  rendersCompleted: number;
  rendersFailed: number;
  revenuePaise: number;
  creditsUsed: number;
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

/** Single-series daily bars: thin rounded columns, recessive baseline, hover tooltip, table for screen readers. */
function DailyBars({ title, points, value, format = String }: { title: string; points: DayPoint[]; value: (p: DayPoint) => number; format?: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.map(value));
  const total = points.reduce((t, p) => t + value(p), 0);
  const h = 96;
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs tabular-nums text-muted-foreground">{hover !== null ? `${points[hover]!.day}: ${format(value(points[hover]!))}` : `${format(total)} in ${points.length} days`}</p>
      </div>
      <div className="relative mt-3 flex items-end gap-[2px] border-b border-border" style={{ height: h }} aria-hidden onMouseLeave={() => setHover(null)}>
        {points.map((p, i) => {
          const v = value(p);
          return (
            <div key={p.day} className="flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)}>
              <div className={cn('w-full rounded-t-[4px] transition-opacity', hover === null || hover === i ? 'bg-primary' : 'bg-primary/40')} style={{ height: v ? Math.max(2, (v / max) * (h - 4)) : 0 }} />
            </div>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <th>{p.day}</th>
              <td>{format(value(p))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Overview() {
  const { data: o } = useAdmin<OverviewData>(['overview'], '/admin/overview');
  const { data: m } = useAdmin<DayPoint[]>(['metrics'], '/admin/metrics?days=30');
  if (!o) return <Skeleton className="h-64" />;
  const d = o.data;
  return (
    <div className="grid gap-6">
      {(d.failedWebhooks > 0 || d.jobs30.failureRate > 10) && (
        <Notice tone="warning" title="Needs attention">
          {d.failedWebhooks > 0 && `${d.failedWebhooks} payment webhook(s) failed to process. `}
          {d.jobs30.failureRate > 10 && `Job failure rate is ${d.jobs30.failureRate}% over 30 days.`}
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Users" value={d.users.total} sub={`${d.users.signups7} new this week · ${d.users.suspended} suspended`} />
        <Stat label="Revenue (30 days)" value={formatInr(d.revenue.last30Paise)} sub={`${d.revenue.payments30} payments · ${formatInr(d.revenue.monthPaise)} this month`} />
        <Stat label="Paid subscriptions" value={d.subscriptions.active} sub={Object.entries(d.plans).map(([k, v]) => `${k} ${v}`).join(' · ')} />
        <Stat label="Jobs (30 days)" value={d.jobs30.completed} sub={`${d.jobs30.failed} failed (${d.jobs30.failureRate}%) · queue ${d.queue.queued ?? 0}/${d.queue.active ?? 0}`} />
        <Stat label="Credits used (30 days)" value={Math.abs(d.credits30.consume ?? 0)} sub={`${(d.credits30.purchase ?? 0) + (d.credits30.grant ?? 0)} granted/bought`} />
        <Stat label="Projects" value={Object.values(d.projects).reduce((a, b) => a + b, 0)} sub={Object.entries(d.projects).map(([k, v]) => `${k} ${v}`).join(' · ')} />
        <Stat label="Storage" value={formatBytes(d.storageBytes)} />
        <Stat label="Verified users" value={`${d.users.total ? Math.round((d.users.verified / d.users.total) * 100) : 0}%`} sub={`${d.users.verified} of ${d.users.total}`} />
      </div>
      {m ? (
        <div className="grid gap-3 md:grid-cols-2">
          <DailyBars title="Sign-ups per day" points={m.data} value={(p) => p.signups} />
          <DailyBars title="Revenue per day" points={m.data} value={(p) => p.revenuePaise} format={(n) => formatInr(n)} />
          <DailyBars title="Videos & voiceovers made per day" points={m.data} value={(p) => p.rendersCompleted} />
          <DailyBars title="Failed jobs per day" points={m.data} value={(p) => p.rendersFailed} />
        </div>
      ) : (
        <Skeleton className="h-48" />
      )}
    </div>
  );
}

/* ── Users ── */

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  emailVerified: boolean;
  plan: string;
  credits: number;
  createdAt: string;
  lastLoginAt: string | null;
}

function Users() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useAdmin<UserRow[]>(['users', query], `/admin/users?limit=50${query ? `&q=${encodeURIComponent(query)}` : ''}`);
  return (
    <div className="grid gap-4">
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email or name" aria-label="Search users" />
        <Button type="submit" variant="outline">
          <Search /> Search
        </Button>
      </form>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2 text-right">Credits</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {data?.data.map((u) => (
                <tr key={u.id} className="cursor-pointer border-t border-border hover:bg-muted/30" onClick={() => setOpen(u.id)}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{u.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.email} {u.role !== 'customer' && <Badge className="ml-1">{u.role}</Badge>}
                    </p>
                  </td>
                  <td className="px-3 py-2 capitalize">{u.plan}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{u.credits}</td>
                  <td className="px-3 py-2">
                    <Badge variant={u.status === 'active' ? 'success' : 'destructive'}>{u.status}</Badge>
                    {!u.emailVerified && <span className="ml-1 text-xs text-muted-foreground">unverified</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{data?.meta?.total ?? 0} users</p>
        </div>
      )}
      {open && <UserDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

interface UserDetail {
  user: { id: string; email: string; fullName: string; role: string; status: string; emailVerified: boolean; googleLinked: boolean; createdAt: string; lastLoginAt: string | null };
  workspace: { plan: string; credits: number; storageBytes: number } | null;
  projects: Record<string, number>;
  subscription: { planId: string; period: string; status: string; currentEnd: string | null } | null;
  payments: Array<{ id: string; kind: string; status: string; amountPaise: number; createdAt: string }>;
  credits: Array<{ type: string; amount: number; balanceAfter: number | null; note: string; createdAt: string }>;
  activeSessions: number;
  audit: Array<{ action: string; createdAt: string; ip: string }>;
}

function UserDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { user: me } = useAuth();
  const { data } = useAdmin<UserDetail>(['user', id], `/admin/users/${id}`);
  const [amount, setAmount] = useState('');
  const [plan, setPlan] = useState('');
  const [reason, setReason] = useState('');
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin'] });
    setReason('');
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body: Record<string, unknown> }) => api(`/admin/users/${id}/${path}`, { method: 'POST', body: { ...body, reason } }),
    onSuccess: () => {
      toast.success('Done — recorded in the audit log');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = data?.data;
  const self = d?.user.id === me?.id;
  const reasonOk = reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle className="text-lg font-semibold">{d ? d.user.fullName : 'Loading…'}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{d?.user.email}</DialogDescription>
        {!d ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="grid gap-4 text-sm">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              <span className="text-muted-foreground">Status</span>
              <span>
                {d.user.status} · {d.user.role}
              </span>
              <span className="text-muted-foreground">Plan / credits</span>
              <span className="capitalize">
                {d.workspace?.plan} · {d.workspace?.credits} credits
              </span>
              <span className="text-muted-foreground">Subscription</span>
              <span>{d.subscription ? `${d.subscription.planId} (${d.subscription.period}) · ${d.subscription.status}` : 'none'}</span>
              <span className="text-muted-foreground">Projects</span>
              <span>{Object.entries(d.projects).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}</span>
              <span className="text-muted-foreground">Joined / last sign-in</span>
              <span>
                {when(d.user.createdAt)} / {when(d.user.lastLoginAt)}
              </span>
              <span className="text-muted-foreground">Signed-in devices</span>
              <span>{d.activeSessions}</span>
            </div>

            {self ? (
              <Notice tone="info">This is your own account — account actions are disabled.</Notice>
            ) : (
              <div className="grid gap-3 rounded-lg border border-border p-3">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, saved in the audit log)" aria-label="Reason" maxLength={300} />
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, ''))} placeholder="+/- credits" className="w-32" aria-label="Credit adjustment" />
                  <Button size="sm" variant="outline" disabled={!reasonOk || !Number(amount) || act.isPending} onClick={() => act.mutate({ path: 'credits', body: { amount: Number(amount), requestId: crypto.randomUUID() } })}>
                    Adjust credits
                  </Button>
                  <Select value={plan} onChange={(e) => setPlan(e.target.value)} className="w-36" aria-label="Plan">
                    <option value="">Set plan…</option>
                    {['free', 'starter', 'creator', 'pro', 'agency'].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" variant="outline" disabled={!reasonOk || !plan || act.isPending} onClick={() => act.mutate({ path: 'plan', body: { plan } })}>
                    Apply plan
                  </Button>
                  {d.user.status === 'active' ? (
                    <Button size="sm" variant="destructive" disabled={!reasonOk || act.isPending} onClick={() => act.mutate({ path: 'status', body: { status: 'suspended' } })}>
                      <ShieldAlert /> Suspend
                    </Button>
                  ) : (
                    d.user.status === 'suspended' && (
                      <Button size="sm" variant="outline" disabled={!reasonOk || act.isPending} onClick={() => act.mutate({ path: 'status', body: { status: 'active' } })}>
                        Reactivate
                      </Button>
                    )
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">Suspending signs the person out everywhere immediately. Plans can’t be set here while a paid Razorpay subscription is active.</p>
              </div>
            )}

            <div>
              <p className="mb-1 font-semibold">Recent credit changes</p>
              <ul className="grid gap-1 text-xs">
                {d.credits.map((c, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString('en-IN')} · {c.note || c.type}
                    </span>
                    <span className="tabular-nums">
                      {c.amount > 0 ? '+' : ''}
                      {c.amount} → {c.balanceAfter}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 font-semibold">Recent activity</p>
              <ul className="grid gap-1 text-xs text-muted-foreground">
                {d.audit.map((a, i) => (
                  <li key={i}>
                    {when(a.createdAt)} · {a.action} {a.ip && `· ${a.ip}`}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Jobs, payments, voices, audit ── */

function ReasonButton({ label, onConfirm, variant = 'outline' }: { label: string; onConfirm: (reason: string) => void; variant?: 'outline' | 'destructive' }) {
  return (
    <Button
      size="sm"
      variant={variant}
      onClick={() => {
        const r = window.prompt(`${label}: reason (saved in the audit log)`);
        if (r && r.trim().length >= 3) onConfirm(r.trim());
        else if (r !== null) toast.error('Please give a reason of at least 3 characters.');
      }}
    >
      {label}
    </Button>
  );
}

function Jobs() {
  const { data } = useAdmin<Array<{ id: string; type: string; error: string | null; attempts: number; project: { title: string; mode: string } | null; updatedAt: string }>>(['jobs'], '/admin/jobs?status=dead&limit=50');
  const retry = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api(`/admin/jobs/${id}/retry`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      toast.success('Queued again (free of charge)');
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!data) return <Skeleton className="h-40" />;
  if (!data.data.length) return <p className="text-sm text-muted-foreground">No failed jobs.</p>;
  return (
    <ul className="grid gap-2">
      {data.data.map((j) => (
        <li key={j.id}>
          <Card className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">
                {j.project?.title ?? '(no project)'} <span className="text-xs text-muted-foreground">· {j.type} · {j.attempts} attempts · {when(j.updatedAt)}</span>
              </p>
              <p className="truncate text-xs text-destructive">{j.error}</p>
            </div>
            <ReasonButton label="Retry free" onConfirm={(reason) => retry.mutate({ id: j.id, reason })} />
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Payments() {
  const [status, setStatus] = useState('');
  const { data } = useAdmin<Array<{ id: string; kind: string; status: string; amountPaise: number; credits: number; planId: string | null; userEmail: string | null; invoice: string | null; failureReason: string | null; createdAt: string }>>(['payments', status], `/admin/payments?limit=100${status ? `&status=${status}` : ''}`);
  return (
    <div className="grid gap-3">
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Payment status">
        <option value="">Paid & failed</option>
        <option value="paid">Paid</option>
        <option value="failed">Failed</option>
      </Select>
      {!data ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">What</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2 text-xs text-muted-foreground">{when(p.createdAt)}</td>
                  <td className="px-3 py-2">{p.userEmail ?? '—'}</td>
                  <td className="px-3 py-2">{p.kind === 'credits' ? `${p.credits} credits` : `${p.planId} plan`}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInr(p.amountPaise)}</td>
                  <td className="px-3 py-2">
                    <Badge variant={p.status === 'paid' ? 'success' : 'destructive'}>{p.status}</Badge>
                    {p.failureReason && <span className="ml-1 text-xs text-muted-foreground">{p.failureReason}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">{p.invoice ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.data.length && <p className="px-3 py-4 text-sm text-muted-foreground">No payments yet.</p>}
        </div>
      )}
    </div>
  );
}

function Voices() {
  const { data } = useAdmin<Array<{ id: string; subjectName: string; subjectEmail: string; relationship: string; status: string; statementMatch: number; createdAt: string; voice: { name: string; status: string } | null }>>(['consents'], '/admin/consents?limit=100');
  const revoke = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api(`/admin/consents/${id}/revoke`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      toast.success('Voice taken down and recordings deleted');
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!data) return <Skeleton className="h-40" />;
  if (!data.data.length) return <p className="text-sm text-muted-foreground">No voice consents yet.</p>;
  return (
    <ul className="grid gap-2">
      {data.data.map((c) => (
        <li key={c.id}>
          <Card className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">
                {c.voice?.name ?? '(voice removed)'} · {c.subjectName} <span className="text-xs text-muted-foreground">({c.relationship === 'self' ? 'own voice' : c.subjectEmail})</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {c.status} · consent match {Math.round(c.statementMatch * 100)}% · {when(c.createdAt)}
              </p>
            </div>
            {c.status !== 'revoked' && <ReasonButton label="Take down" variant="destructive" onConfirm={(reason) => revoke.mutate({ id: c.id, reason })} />}
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Audit() {
  const [action, setAction] = useState('');
  const { data } = useAdmin<Array<{ id: string; action: string; actor: string | null; ip: string; metadata: Record<string, unknown>; createdAt: string }>>(['audit', action], `/admin/audit?limit=100${action ? `&action=${encodeURIComponent(action)}` : ''}`);
  return (
    <div className="grid gap-3">
      <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-56" aria-label="Filter actions">
        <option value="">All actions</option>
        <option value="admin.">Admin actions</option>
        <option value="auth.">Sign-ins & accounts</option>
        <option value="billing.">Billing</option>
        <option value="consent.">Voice consent</option>
        <option value="project.">Projects</option>
      </Select>
      {!data ? (
        <Skeleton className="h-40" />
      ) : (
        <ul className="grid gap-1 text-sm">
          {data.data.map((a) => (
            <li key={a.id} className="rounded-md border border-border px-3 py-2">
              <span className="font-mono text-xs">{a.action}</span> <span className="text-xs text-muted-foreground">· {a.actor ?? 'system'} · {when(a.createdAt)} {a.ip && `· ${a.ip}`}</span>
              {Object.keys(a.metadata ?? {}).length > 0 && <p className="mt-0.5 truncate text-xs text-muted-foreground">{JSON.stringify(a.metadata)}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
