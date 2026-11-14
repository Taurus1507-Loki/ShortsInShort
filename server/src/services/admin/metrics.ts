import { User } from '../../models/User.js';
import { Job } from '../../models/Job.js';
import { Payment } from '../../models/Billing.js';
import { CreditTransaction } from '../../models/CreditTransaction.js';

/** Days are bucketed in Indian time so "today" matches what the team sees. */
const TZ = 'Asia/Kolkata';

export interface DayPoint {
  day: string;
  signups: number;
  rendersCompleted: number;
  rendersFailed: number;
  revenuePaise: number;
  creditsUsed: number;
}

/** Daily product and revenue series for the last `days` days (every day present, zeros included). */
export async function dailySeries(days: number): Promise<DayPoint[]> {
  const from = new Date(Date.now() - days * 86_400_000);
  const dayOf = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: TZ } });
  const [signups, jobs, revenue, credits] = await Promise.all([
    User.aggregate([{ $match: { createdAt: { $gte: from } } }, { $group: { _id: dayOf('createdAt'), n: { $sum: 1 } } }]),
    Job.aggregate([
      { $match: { updatedAt: { $gte: from }, status: { $in: ['completed', 'dead'] }, type: { $in: ['render_project', 'narrate_project'] } } },
      { $group: { _id: { day: dayOf('updatedAt'), status: '$status' }, n: { $sum: 1 } } },
    ]),
    Payment.aggregate([{ $match: { status: 'paid', paidAt: { $gte: from } } }, { $group: { _id: dayOf('paidAt'), n: { $sum: '$amountPaise' } } }]),
    CreditTransaction.aggregate([{ $match: { status: 'applied', type: 'consume', createdAt: { $gte: from } } }, { $group: { _id: dayOf('createdAt'), n: { $sum: '$amount' } } }]),
  ]);
  const map = <T extends { _id: unknown; n: number }>(rows: T[], key: (r: T) => string) => new Map(rows.map((r) => [key(r), r.n]));
  const s = map(signups, (r) => r._id as string);
  const ok = map(jobs.filter((j) => j._id.status === 'completed'), (r) => r._id.day);
  const bad = map(jobs.filter((j) => j._id.status === 'dead'), (r) => r._id.day);
  const rev = map(revenue, (r) => r._id as string);
  const cr = map(credits, (r) => r._id as string);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = fmt.format(new Date(Date.now() - i * 86_400_000));
    out.push({ day, signups: s.get(day) ?? 0, rendersCompleted: ok.get(day) ?? 0, rendersFailed: bad.get(day) ?? 0, revenuePaise: rev.get(day) ?? 0, creditsUsed: Math.abs(cr.get(day) ?? 0) });
  }
  return out;
}
