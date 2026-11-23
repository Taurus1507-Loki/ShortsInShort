import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, PlayCircle, ShieldCheck, IndianRupee, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProductPreview } from '@/components/marketing/ProductPreview';
import { BeforeAfter } from '@/components/marketing/BeforeAfter';
import { FAQ, Features, FinalCTA, HowItWorks, Pricing, SectionHeading, TemplatesShowcase } from '@/components/marketing/sections';
import { PriceCalculator } from '@/components/marketing/PriceCalculator';

const PLATFORMS = ['Instagram Reels', 'YouTube Shorts', 'TikTok', 'YouTube', 'Instagram Feed'];

export default function LandingPage() {
  const reduce = useReducedMotion();
  const fade = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const } };

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="bg-grid absolute inset-0 -z-10" aria-hidden />
        <div className="absolute left-1/2 top-0 -z-10 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" aria-hidden />
        <div className="container grid items-center gap-14 pb-20 pt-14 lg:grid-cols-[1.05fr_1fr] lg:pb-28 lg:pt-20">
          <div>
            <motion.p {...fade(0)} className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-semibold text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Your Script. Your AI Editor. Your Video. Done.
            </motion.p>
            <motion.h1 {...fade(0.05)} className="mt-6 text-4xl font-extrabold leading-[1.05] sm:text-5xl lg:text-6xl">
              Create <span className="text-gradient">Scroll-Stopping</span> Videos in Minutes with AI.
            </motion.h1>
            <motion.p {...fade(0.12)} className="mt-6 max-w-xl text-lg text-muted-foreground">
              Upload raw footage and press Auto edit. Or paste a script and get a faceless video — or one with your own face and voice, from a single photo. Hook, captions, B-roll, motion graphics, music and sound effects in every video.
            </motion.p>
            <motion.div {...fade(0.18)} className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" variant="gradient">
                <Link to="/register">
                  Start Creating Free <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#demo">
                  <PlayCircle /> Watch Demo
                </a>
              </Button>
            </motion.div>
            <motion.ul {...fade(0.24)} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <IndianRupee className="h-4 w-4 text-accent" /> Free plan, INR pricing
              </li>
              <li className="flex items-center gap-2">
                <Languages className="h-4 w-4 text-accent" /> 5 Indian languages
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-accent" /> Private by default
              </li>
            </motion.ul>
          </div>
          <motion.div {...(reduce ? {} : { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.7, delay: 0.15 } })}>
            <ProductPreview />
          </motion.div>
        </div>

        <div className="border-y border-border bg-card/30">
          <ul className="container flex flex-wrap items-center justify-center gap-x-10 gap-y-3 py-5 text-sm font-semibold text-muted-foreground" aria-label="Supported platforms">
            {PLATFORMS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Before / after */}
      <section id="demo" className="scroll-mt-20 py-24">
        <div className="container">
          <BeforeAfter />
        </div>
      </section>

      <HowItWorks />
      <Features />
      <MadeFor />
      <TemplatesShowcase />
      <Pricing />
      <section id="calculator" className="scroll-mt-20 pb-8">
        <div className="container max-w-4xl">
          <PriceCalculator />
        </div>
      </section>
      <Compare />
      <FAQ />
      <FinalCTA />
    </>
  );
}

const NICHES = [
  ['Creators', 'Post every day without editing every night.'],
  ['Doctors & clinics', 'Health tips in your face and voice — no shoot days.'],
  ['Coaches', 'Turn one idea into a week of reels.'],
  ['Finance & CAs', 'Explain money with animated numbers.'],
  ['Real estate', 'Property tours and offers that sell.'],
  ['Agencies', 'One brand kit per client, a month of reels in one batch.'],
];

function MadeFor() {
  return (
    <section className="py-20">
      <div className="container">
        <SectionHeading eyebrow="Who it’s for" title="Made for people who need reels again and again" />
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NICHES.map(([name, line]) => (
            <li key={name} className="rounded-xl border border-border bg-card/60 p-5">
              <p className="font-semibold">{name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{line}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Typical ways to get 20 reels a month in India (rough market ranges) next to ShortsInShort. */
const COMPARE = [
  { who: 'Freelance editor', cost: '₹1,500–2,000 per reel', camera: 'You film every video', speed: 'Days per batch' },
  { who: 'Full-time editor', cost: '₹25,000–35,000 a month', camera: 'You film every video', speed: 'Limited to one person’s hours' },
  { who: 'Agency retainer', cost: '₹40,000–60,000 a month, often 4–8 reels', camera: 'Shoot days at their studio', speed: 'Their schedule' },
  { who: 'ShortsInShort', cost: '₹499 per edited video, ₹799 per faceless reel — pay per video', camera: 'No camera needed (faceless or your avatar)', speed: 'Minutes, any time' },
];

function Compare() {
  return (
    <section className="py-20">
      <div className="container max-w-5xl">
        <SectionHeading eyebrow="Why ShortsInShort" title="Reels without an editor, a studio or a contract" subtitle="Rough market ranges for 20 reels a month. Use the calculator above for your exact numbers." />
        <div className="mt-10 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-card/80 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Option</th>
                <th className="px-4 py-3 font-semibold">Cost</th>
                <th className="px-4 py-3 font-semibold">Filming</th>
                <th className="px-4 py-3 font-semibold">Speed</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((r) => (
                <tr key={r.who} className={r.who === 'ShortsInShort' ? 'bg-primary/10 font-medium' : 'border-t border-border'}>
                  <td className="px-4 py-3">{r.who}</td>
                  <td className="px-4 py-3">{r.cost}</td>
                  <td className="px-4 py-3">{r.camera}</td>
                  <td className="px-4 py-3">{r.speed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
