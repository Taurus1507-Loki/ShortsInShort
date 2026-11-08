import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AudioLines, Captions, Check, Film, Music2, Scissors, Sparkles, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEPS = [
  { icon: AudioLines, label: 'Transcribe speech' },
  { icon: Scissors, label: 'Remove silences & filler' },
  { icon: Captions, label: 'Animated captions' },
  { icon: Film, label: 'Match B-roll' },
  { icon: Music2, label: 'Music & ducking' },
  { icon: Wand2, label: 'Render 9:16 · 1080p' },
];

const CAPTION = ['Stop', 'scrolling.', 'This', 'one', 'habit', 'doubled', 'my', 'reach.'];
const KEYWORDS = new Set(['doubled', 'reach.']);

/**
 * Interface illustration of the creation flow — built in HTML/CSS, not a recording of real output.
 * It is labelled as such on the page.
 */
export function ProductPreview() {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(reduce ? STEPS.length : 0);
  const [word, setWord] = useState(reduce ? CAPTION.length : 0);

  useEffect(() => {
    if (reduce) return;
    const s = setInterval(() => setStep((v) => (v >= STEPS.length + 2 ? 0 : v + 1)), 900);
    const w = setInterval(() => setWord((v) => (v >= CAPTION.length + 3 ? 0 : v + 1)), 420);
    return () => {
      clearInterval(s);
      clearInterval(w);
    };
  }, [reduce]);

  const visible = CAPTION.slice(Math.max(0, Math.min(word, CAPTION.length) - 4), Math.min(word, CAPTION.length));

  return (
    <figure className="relative mx-auto w-full max-w-[560px]" aria-label="Illustration of the ShortsInShort editor">
      <div className="absolute -inset-8 -z-10 rounded-[40px] bg-brand-gradient opacity-20 blur-3xl" aria-hidden />
      <div className="overflow-hidden rounded-2xl border border-border bg-card/80 shadow-glow backdrop-blur">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
          <span className="ml-3 truncate text-xs text-muted-foreground">Project · “Morning routine reel”</span>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 p-4 sm:gap-5 sm:p-5">
          {/* phone canvas */}
          <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-gradient-to-br from-[#1c1446] via-[#0d1a33] to-[#062a33]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(167,139,250,0.35),transparent_55%)]" />
            {/* silhouette */}
            <div className="absolute bottom-0 left-1/2 h-[62%] w-[70%] -translate-x-1/2 rounded-t-[999px] bg-gradient-to-b from-white/15 to-white/5" />
            <div className="absolute left-1/2 top-[22%] h-[22%] w-[34%] -translate-x-1/2 rounded-full bg-white/15" />
            <div className="absolute left-3 top-3 rounded-md bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold text-white/80">9:16</div>
            {/* caption */}
            <div className="absolute inset-x-2 bottom-[18%] flex flex-wrap justify-center gap-x-1.5 gap-y-1 text-center">
              {visible.map((w, i) => (
                <motion.span
                  key={`${w}-${word}-${i}`}
                  initial={reduce ? false : { scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                  className={cn(
                    'font-display text-[13px] font-extrabold uppercase leading-tight tracking-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] sm:text-base',
                    KEYWORDS.has(w) && 'rounded bg-highlight px-1 text-[#1a1036]',
                  )}
                >
                  {w}
                </motion.span>
              ))}
            </div>
          </div>

          {/* pipeline */}
          <div className="flex min-w-0 flex-col">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-highlight" /> AI pipeline
            </div>
            <ol className="grid gap-2">
              {STEPS.map((s, i) => {
                const done = step > i;
                const active = step === i;
                return (
                  <li
                    key={s.label}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-[12px] transition-colors sm:text-[13px]',
                      done ? 'border-success/30 bg-success/10' : active ? 'border-primary/40 bg-primary/10' : 'border-border bg-background/40',
                    )}
                  >
                    <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md', done ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground')}>
                      {done ? <Check className="h-3.5 w-3.5" /> : <s.icon className="h-3.5 w-3.5" />}
                    </span>
                    <span className="truncate">{s.label}</span>
                  </li>
                );
              })}
            </ol>
            {/* timeline */}
            <div className="mt-auto hidden gap-1.5 pt-4 sm:grid" aria-hidden>
              <div className="flex h-3 gap-0.5">
                {[30, 14, 22, 18, 26].map((w, i) => (
                  <div key={i} className="rounded-sm bg-primary/60" style={{ width: `${w}%` }} />
                ))}
              </div>
              <div className="flex h-2 gap-0.5">
                {[12, 20, 10, 24, 16, 18].map((w, i) => (
                  <div key={i} className="rounded-sm bg-accent/60" style={{ width: `${w}%` }} />
                ))}
              </div>
              <div className="h-2 rounded-sm bg-highlight/30" />
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">Interface illustration — not actual customer output.</figcaption>
    </figure>
  );
}
