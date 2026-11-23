import { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { Select } from '../ui/input';
import { Skeleton } from '../ui/primitives';
import { useMeta } from '@/lib/queries';
import { cn, formatInr } from '@/lib/utils';
import type { Meta } from '@/types/api';

/**
 * ₹ price calculator: what one video costs in credits and rupees, and what a month of videos costs on
 * each plan. Uses the live per-step prices and plan prices from /api/meta, with the same rules as the
 * server (per started 30 s; the AI Video Editor per started minute of footage).
 */
type Kind = 'edit' | 'faceless_stock' | 'faceless_motion' | 'presenter_photo' | 'presenter_stock';

const KINDS: Array<{ id: Kind; name: string; blurb: string }> = [
  { id: 'edit', name: 'Edit my video', blurb: 'Your footage, auto-edited: cuts, hook, captions, B-roll, graphics, music' },
  { id: 'faceless_stock', name: 'Faceless — stock footage', blurb: 'Your script, AI voice, matching stock clips' },
  { id: 'faceless_motion', name: 'Faceless — animated', blurb: 'Your script, AI voice, animated explainer scenes' },
  { id: 'presenter_photo', name: 'Personal branding — your avatar', blurb: 'Your photo avatar speaks your script' },
  { id: 'presenter_stock', name: 'AI presenter — stock', blurb: 'A ready-made presenter speaks your script' },
];

const per30 = (sec: number) => Math.max(1, Math.ceil(sec / 30));
const perMin = (sec: number) => Math.max(1, Math.ceil(sec / 60));

export function creditsFor(kind: Kind, sec: number, pricing: Meta['pricing']) {
  const p = (step: string, fallback: number) => pricing.find((x) => x.step === step)?.credits ?? fallback;
  switch (kind) {
    case 'edit':
      return perMin(sec) * (p('editor_analyze', 3) + p('editor_rerender', 2));
    case 'faceless_stock':
      return per30(sec) * (p('voice', 2) + p('export', 3));
    case 'faceless_motion':
      return per30(sec) * (p('voice', 2) + p('export_motion', 5));
    case 'presenter_photo':
      return per30(sec) * (p('voice', 2) + p('export', 3) + p('presenter_photo', 80));
    case 'presenter_stock':
      return per30(sec) * (p('voice', 2) + p('export', 3) + p('presenter', 160));
  }
}

const LENGTHS = [15, 30, 45, 60, 90, 120, 180];

export function PriceCalculator({ className }: { className?: string }) {
  const { data: meta, isLoading } = useMeta();
  const [kind, setKind] = useState<Kind>('faceless_stock');
  const [sec, setSec] = useState(45);
  const [perMonth, setPerMonth] = useState(20);

  const result = useMemo(() => {
    if (!meta) return null;
    const credits = creditsFor(kind, sec, meta.pricing);
    const paid = meta.plans.filter((p) => p.monthlyPricePaise > 0 && p.monthlyCredits > 0);
    const plans = paid.map((p) => {
      const perCredit = p.monthlyPricePaise / 100 / p.monthlyCredits;
      return { id: p.id, name: p.name, perCredit, perVideo: credits * perCredit, fits: Math.floor(p.monthlyCredits / credits), price: p.monthlyPricePaise / 100 };
    });
    const need = credits * perMonth;
    // The cheapest plan whose monthly credits cover the month, else the biggest.
    const best = plans.find((p) => p.fits >= perMonth) ?? plans[plans.length - 1] ?? null;
    return { credits, plans, need, best };
  }, [meta, kind, sec, perMonth]);

  return (
    <div className={cn('rounded-2xl border border-border bg-card/60 p-6', className)}>
      <h3 className="flex items-center gap-2 text-lg font-bold">
        <Calculator className="h-5 w-5 text-primary" /> What will my videos cost?
      </h3>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <label className="grid gap-1.5 text-sm md:col-span-3">
          <span className="font-medium">Type of video</span>
          <Select id="calc-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </Select>
          <span className="text-xs text-muted-foreground">{KINDS.find((k) => k.id === kind)?.blurb}</span>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Length</span>
          <Select id="calc-length" value={String(sec)} onChange={(e) => setSec(Number(e.target.value))}>
            {LENGTHS.map((l) => (
              <option key={l} value={l}>
                {l < 60 ? `${l} seconds` : `${l / 60} minute${l === 60 ? '' : 's'}`}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1.5 text-sm md:col-span-2">
          <span className="font-medium">Videos per month: {perMonth}</span>
          <input id="calc-month" type="range" min={1} max={60} value={perMonth} onChange={(e) => setPerMonth(Number(e.target.value))} className="accent-[hsl(var(--primary))]" />
        </label>
      </div>

      {isLoading || !result ? (
        <Skeleton className="mt-6 h-32" />
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1.4fr]">
          <div className="rounded-xl bg-primary/10 p-4">
            <p className="text-sm text-muted-foreground">One video</p>
            <p className="mt-1 font-display text-3xl font-extrabold">{result.credits} credits</p>
            {result.plans.length > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                ≈ {formatInr(Math.round(result.plans[result.plans.length - 1]!.perVideo * 100))}–{formatInr(Math.round(result.plans[0]!.perVideo * 100))} depending on the plan
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">Includes everything in the video. Fixing it later? The next 2 re-exports of each video are free.</p>
          </div>
          <div className="grid gap-1.5 text-sm">
            <p className="font-medium">
              {perMonth} videos a month = {result.need.toLocaleString('en-IN')} credits
            </p>
            {result.plans.map((p) => (
              <div key={p.id} className={cn('flex items-center justify-between rounded-lg border px-3 py-2', result.best?.id === p.id ? 'border-primary bg-primary/10' : 'border-border')}>
                <span>
                  <strong>{p.name}</strong> · {formatInr(p.price * 100)}/mo
                </span>
                <span className="text-muted-foreground">
                  {p.fits >= perMonth ? `covers ${perMonth}` : `${p.fits} of ${perMonth}`} · {formatInr(Math.round(p.perVideo * 100))}/video
                </span>
              </div>
            ))}
            {result.best && result.best.fits < perMonth && <p className="text-xs text-muted-foreground">For more, add credit top-ups or talk to us about a bigger plan.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
