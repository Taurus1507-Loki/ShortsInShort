import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  Captions,
  Check,
  Clapperboard,
  Film,
  Globe2,
  LayoutTemplate,
  Palette,
  Sparkles,
  Upload,
  UserRound,
  Wand2,
  Download,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/overlays';
import { Badge, Skeleton } from '../ui/primitives';
import { useMeta } from '@/lib/queries';
import { cn, formatBytes, formatInr } from '@/lib/utils';
import { STYLES } from '@/config/options';

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: ReactNode; subtitle?: string }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-4 text-muted-foreground">{subtitle}</p>}
    </Reveal>
  );
}

/* ── How it works ───────────────────────────────────────────────────── */
const STEPS = [
  { icon: Upload, title: 'Upload or write', body: 'Drop in raw footage, or type a script or topic.' },
  { icon: SlidersHorizontal, title: 'Pick a style', body: 'Choose an editing style, captions, music and format.' },
  { icon: Sparkles, title: 'AI does the edit', body: 'Transcription, cuts, captions, B-roll and music, automatically.' },
  { icon: Download, title: 'Tweak & export', body: 'Preview, adjust anything, then download in HD.' },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 py-24">
      <div className="container">
        <SectionHeading eyebrow="How it works" title="Four steps. No editing skills." subtitle="From idea to a platform-ready video without opening a timeline — unless you want to." />
        <ol className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.06}>
              <li className="relative h-full rounded-xl border border-border bg-card/60 p-6">
                <span className="absolute right-5 top-5 font-display text-4xl font-extrabold text-muted-foreground/15">{i + 1}</span>
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-gradient text-white shadow-glow">
                  <s.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── Features ───────────────────────────────────────────────────────── */
const FEATURES = [
  { icon: Wand2, title: 'AI Video Editor', body: 'Silence removal, smart cuts, zooms and pacing tuned for short-form retention.', size: 'lg' },
  { icon: UserRound, title: 'AI Avatar Studio', body: 'Present scripts with your own consented avatar and voice. Consent records built in.', size: 'lg' },
  { icon: Clapperboard, title: 'Faceless Creator', body: 'Topic → script → scenes → narration, with licensed visuals.' },
  { icon: Captions, title: 'Professional Captions', body: 'Word-synced, animated, with keyword highlights.' },
  { icon: Film, title: 'Automated B-roll', body: 'Relevant, licensed cutaways matched to what you say.' },
  { icon: LayoutTemplate, title: 'Video Templates', body: 'Proven styles for every niche and platform.' },
  { icon: Palette, title: 'Brand Kit', body: 'Your logo, colours, fonts and intros on every video.' },
  { icon: Globe2, title: 'Multilingual', body: 'English, Hindi, Telugu, Tamil and Marathi first.' },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 py-24">
      <div className="container">
        <SectionHeading eyebrow="Features" title={<>Everything a pro editor does. <span className="text-gradient">Automated.</span></>} subtitle="Three creation modes on one engine — so your brand, captions and style stay consistent everywhere." />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 4) * 0.05} className={cn(f.size === 'lg' && 'lg:col-span-2')}>
              <article className="group h-full rounded-xl border border-border bg-card/60 p-6 transition-colors hover:border-primary/40">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/15 text-highlight transition-transform group-hover:scale-110">
                  <f.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-bold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Templates ──────────────────────────────────────────────────────── */
const TEMPLATE_LOOKS: Record<string, { bg: string; caption: string; sample: string }> = {
  viral: { bg: 'from-[#4c1d95] to-[#be185d]', caption: 'bg-yellow-300 text-black', sample: 'WAIT FOR IT' },
  podcast: { bg: 'from-[#0f172a] to-[#334155]', caption: 'text-white', sample: 'the real reason why' },
  cinematic: { bg: 'from-[#111827] to-[#78350f]', caption: 'text-amber-100 tracking-[0.3em]', sample: 'CHAPTER ONE' },
  educational: { bg: 'from-[#0c4a6e] to-[#0e7490]', caption: 'bg-cyan-300 text-black', sample: '3 key ideas' },
  business: { bg: 'from-[#1e1b4b] to-[#312e81]', caption: 'bg-white text-indigo-900', sample: '+42% revenue' },
  storytelling: { bg: 'from-[#3f1d38] to-[#7c2d12]', caption: 'text-rose-100 italic', sample: 'and then…' },
  vlog: { bg: 'from-[#065f46] to-[#0d9488]', caption: 'bg-pink-400 text-white', sample: 'day in my life' },
  product_promotion: { bg: 'from-[#581c87] to-[#0891b2]', caption: 'bg-white text-purple-800', sample: 'Meet the new' },
};

export function TemplatesShowcase() {
  return (
    <section id="templates" className="scroll-mt-20 py-24">
      <div className="container">
        <SectionHeading eyebrow="Templates" title="Start from a style that already works" subtitle="Each style sets caption animation, pacing, B-roll density, transitions and music mood — then you make it yours." />
        <div className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {STYLES.map((s, i) => {
            const look = TEMPLATE_LOOKS[s.id]!;
            return (
              <Reveal key={s.id} delay={(i % 4) * 0.05}>
                <article className="group overflow-hidden rounded-xl border border-border bg-card/60">
                  <div className={cn('relative grid aspect-[9/14] place-items-center bg-gradient-to-br p-3', look.bg)}>
                    <span className={cn('rounded px-2 py-1 text-center font-display text-sm font-extrabold uppercase transition-transform group-hover:scale-110', look.caption)}>
                      {look.sample}
                    </span>
                  </div>
                  <div className="p-3.5">
                    <h3 className="text-sm font-bold">{s.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.blurb}</p>
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Style previews are design mock-ups; the template marketplace with video previews arrives in a later release.</p>
      </div>
    </section>
  );
}

/* ── Pricing ────────────────────────────────────────────────────────── */
export function Pricing() {
  const { data: meta, isLoading, isError } = useMeta();
  const [annual, setAnnual] = useState(false);
  const plans = meta?.plans ?? [];
  const paymentsLive = meta?.features.payments ?? false;

  return (
    <section id="pricing" className="scroll-mt-20 py-24">
      <div className="container">
        <SectionHeading eyebrow="Pricing" title="Simple plans in INR" subtitle="Start free. Upgrade when you're posting every day. 1 credit ≈ one standard short-form edit." />
        <div className="mt-8 flex justify-center">
          <div className="inline-flex rounded-xl border border-border bg-card/60 p-1" role="group" aria-label="Billing period">
            {[false, true].map((a) => (
              <button
                key={String(a)}
                onClick={() => setAnnual(a)}
                aria-pressed={annual === a}
                className={cn('rounded-lg px-4 py-2 text-sm font-semibold transition', annual === a ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground')}
              >
                {a ? 'Annual · 2 months free' : 'Monthly'}
              </button>
            ))}
          </div>
        </div>

        {isError && <p className="mt-10 text-center text-sm text-muted-foreground">Pricing is temporarily unavailable.</p>}
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-96 rounded-xl" />)
            : plans.map((p) => {
                const featured = p.id === 'creator';
                const price = annual ? p.annualPricePaise / 12 : p.monthlyPricePaise;
                return (
                  <article
                    key={p.id}
                    className={cn('relative flex flex-col rounded-xl border bg-card/60 p-6', featured ? 'border-primary/60 shadow-glow' : 'border-border')}
                  >
                    {featured && <Badge className="absolute -top-2.5 left-6">Most popular</Badge>}
                    <h3 className="text-lg font-bold">{p.name}</h3>
                    <p className="mt-4">
                      <span className="font-display text-3xl font-extrabold">{formatInr(Math.round(price))}</span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                    </p>
                    <p className="mt-1 h-4 text-xs text-muted-foreground">{annual && p.annualPricePaise > 0 ? `${formatInr(p.annualPricePaise)} billed yearly` : ''}</p>
                    <p className="mt-4 text-sm font-semibold text-highlight">{p.monthlyCredits} credits{p.id === 'free' ? '' : ' / month'}</p>
                    <ul className="mt-4 grid flex-1 gap-2.5 text-sm">
                      {p.highlights.map((h) => (
                        <li key={h} className="flex gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                          <span className="text-muted-foreground">{h}</span>
                        </li>
                      ))}
                      <li className="flex gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        <span className="text-muted-foreground">{formatBytes(p.storageBytes)} storage</span>
                      </li>
                    </ul>
                    <Button asChild variant={featured ? 'gradient' : 'outline'} className="mt-6 w-full">
                      <Link to="/register">{p.id === 'free' ? 'Start free' : paymentsLive ? `Choose ${p.name}` : 'Start free'}</Link>
                    </Button>
                  </article>
                );
              })}
        </div>
        {!paymentsLive && !isLoading && (
          <p className="mt-6 text-center text-xs text-muted-foreground">Prices include 18% GST. Pay securely with Razorpay — cancel any time.</p>
        )}
      </div>
    </section>
  );
}

/* ── FAQ ────────────────────────────────────────────────────────────── */
const FAQS = [
  { q: 'Do I need any editing experience?', a: 'No. You upload footage or write a script, choose a style, and the AI produces the edit. You can still fine-tune captions, cuts and music before exporting.' },
  { q: 'What is a credit?', a: 'Credits pay for processing. A standard short-form edit uses about one credit; avatar videos, long-form videos and 4K exports use more. You’ll always see the cost before you confirm a generation, and failed jobs are refunded automatically.' },
  { q: 'Which platforms and formats are supported?', a: 'Vertical 9:16 for Reels, Shorts and TikTok, 16:9 for YouTube, and 1:1 or 4:5 for Instagram feed, at 720p or 1080p (4K on higher plans where supported).' },
  { q: 'Which languages can I use?', a: 'We are launching with English, Hindi, Telugu, Tamil and Marathi for captions and narration, with more languages to follow.' },
  { q: 'Can someone make an avatar of me without permission?', a: 'No. Avatars and voice clones require the person’s own verified consent. Consent is recorded, can be revoked at any time, and revoking it deletes the associated avatar assets.' },
  { q: 'Who owns the videos I create?', a: 'You do. Your uploads stay private to your workspace. Stock media and music we add come from licensed sources and can be used in your published videos under those licences.' },
  { q: 'Can I cancel anytime?', a: 'Yes. Paid plans can be cancelled from your billing page and remain active until the end of the current period.' },
];

export function FAQ() {
  return (
    <section id="faq" className="scroll-mt-20 py-24">
      <div className="container max-w-3xl">
        <SectionHeading eyebrow="FAQs" title="Questions, answered" />
        <Accordion type="single" collapsible className="mt-10">
          {FAQS.map((f, i) => (
            <AccordionItem key={f.q} value={`q${i}`}>
              <AccordionTrigger>{f.q}</AccordionTrigger>
              <AccordionContent>{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

/* ── Final CTA ──────────────────────────────────────────────────────── */
export function FinalCTA() {
  return (
    <section className="py-24">
      <div className="container">
        <Reveal>
          <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card px-6 py-16 text-center sm:px-12">
            <div className="absolute inset-0 -z-0 bg-brand-gradient opacity-[0.12]" aria-hidden />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-extrabold sm:text-5xl">Your next video is a script away.</h2>
              <p className="mx-auto mt-4 max-w-xl text-muted-foreground">Create your free account and set up your first project in under a minute.</p>
              <Button asChild size="lg" variant="gradient" className="mt-8">
                <Link to="/register">
                  Start Creating Free <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
