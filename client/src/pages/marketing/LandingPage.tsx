import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, PlayCircle, ShieldCheck, IndianRupee, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProductPreview } from '@/components/marketing/ProductPreview';
import { BeforeAfter } from '@/components/marketing/BeforeAfter';
import { FAQ, Features, FinalCTA, HowItWorks, Pricing, TemplatesShowcase } from '@/components/marketing/sections';

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
              Transform your footage, scripts, and ideas into professional Instagram Reels, YouTube Shorts, and videos with AI-powered editing. No editing skills required.
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
      <TemplatesShowcase />
      <Pricing />
      <FAQ />
      <FinalCTA />
    </>
  );
}
