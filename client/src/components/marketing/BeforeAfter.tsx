import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Captions, Film, Pause, Play, Scissors, Volume2, VolumeX, ZoomIn } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

const BEFORE_SRC = '/media/sample-before.mp4';
const AFTER_SRC = '/media/sample-after.mp4';
const POSTER = '/media/sample-poster.jpg';

type Side = 'before' | 'after';

const HIGHLIGHTS = [
  { icon: Scissors, label: 'Silences & filler words removed' },
  { icon: Captions, label: 'Word-synced animated captions' },
  { icon: ZoomIn, label: 'Punch-in zooms on key lines' },
  { icon: Film, label: 'Relevant B-roll cutaways' },
];

/** HEAD-checks that both licensed sample files exist before trying to play them. */
function useSampleAvailable() {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([BEFORE_SRC, AFTER_SRC].map((u) => fetch(u, { method: 'HEAD' }).then((r) => r.ok && (r.headers.get('content-type') ?? '').startsWith('video'))))
      .then((oks) => !cancelled && setAvailable(oks.every(Boolean)))
      .catch(() => !cancelled && setAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

export function BeforeAfter() {
  const available = useSampleAvailable();
  const [side, setSide] = useState<Side>('after');
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Keep playback state when switching sides.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    if (playing) void v.play().catch(() => setPlaying(false));
    else v.pause();
  }, [playing, muted, side, available]);

  const isIllustration = available === false;

  return (
    <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_1fr]">
      <div className="order-2 lg:order-1">
        <div className="relative mx-auto aspect-[9/16] max-h-[620px] w-full max-w-[350px] overflow-hidden rounded-2xl border border-border bg-black shadow-glow">
          {available ? (
            <video
              key={side}
              ref={videoRef}
              src={side === 'before' ? BEFORE_SRC : AFTER_SRC}
              poster={POSTER}
              playsInline
              loop
              muted={muted}
              preload="metadata"
              className="h-full w-full object-cover"
              aria-label={side === 'before' ? 'Raw footage before editing' : 'Video after AI editing'}
            />
          ) : (
            <IllustratedClip side={side} playing={playing} />
          )}

          <div className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
            {side === 'before' ? 'Before · raw' : 'After · AI edit'}
          </div>

          {/* controls */}
          <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-xl bg-black/55 p-1.5 backdrop-blur">
            <Button size="icon" variant="ghost" className="h-9 w-9 text-white hover:bg-white/15" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause /> : <Play />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 text-white hover:bg-white/15"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute' : 'Mute'}
              disabled={isIllustration}
              title={isIllustration ? 'The illustration has no audio' : undefined}
            >
              {muted ? <VolumeX /> : <Volume2 />}
            </Button>
            <div className="ml-auto flex rounded-lg bg-white/10 p-0.5" role="tablist" aria-label="Compare versions">
              {(['before', 'after'] as Side[]).map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={side === s}
                  onClick={() => setSide(s)}
                  className={cn('rounded-md px-3 py-1.5 text-xs font-semibold capitalize text-white/80 transition', side === s && 'bg-white text-black')}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
        {isIllustration && (
          <p className="mt-3 text-center text-xs text-muted-foreground">Animated illustration. Licensed sample footage will be added before launch.</p>
        )}
      </div>

      <div className="order-1 lg:order-2">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent">Before → After</p>
        <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">From raw take to ready-to-post</h2>
        <p className="mt-4 text-muted-foreground">
          Record on your phone, upload, and let the AI editor handle the tedious parts. You keep full control to tweak captions, cuts and music before you export.
        </p>
        <ul className="mt-6 grid gap-3">
          {HIGHLIGHTS.map((h) => (
            <li key={h.label} className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-highlight">
                <h.icon className="h-4 w-4" />
              </span>
              <span className="text-sm font-medium">{h.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const RAW = ['so', 'um,', 'the', 'thing', 'is…', '[pause]', 'like,', 'consistency', 'matters', 'more', 'than', 'talent'];
const EDITED = ['Consistency', 'beats', 'talent.', 'Every', 'single', 'time.'];

function IllustratedClip({ side, playing }: { side: Side; playing: boolean }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const words = side === 'before' ? RAW : EDITED;
  useEffect(() => setI(0), [side]);
  useEffect(() => {
    if (!playing || reduce) return;
    const t = setInterval(() => setI((v) => (v + 1) % (words.length + 2)), side === 'before' ? 650 : 420);
    return () => clearInterval(t);
  }, [playing, reduce, words.length, side]);

  const after = side === 'after';
  return (
    <div className={cn('relative h-full w-full', after ? 'bg-gradient-to-br from-[#251a5c] via-[#101b38] to-[#05343d]' : 'bg-gradient-to-br from-[#3a3a3a] to-[#1d1d1d] grayscale')}>
      <motion.div
        className="absolute inset-0"
        animate={after && playing && !reduce ? { scale: [1, 1.08, 1.08, 1] } : { scale: 1 }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div className="absolute bottom-0 left-1/2 h-[60%] w-[72%] -translate-x-1/2 rounded-t-[999px] bg-white/15" />
        <div className="absolute left-1/2 top-[22%] h-[21%] w-[36%] -translate-x-1/2 rounded-full bg-white/15" />
      </motion.div>
      {after ? (
        <div className="absolute inset-x-4 bottom-[22%] flex flex-wrap justify-center gap-1.5">
          {words.slice(Math.max(0, i - 3), i).map((w, k) => (
            <motion.span
              key={`${w}-${i}-${k}`}
              initial={reduce ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={cn('font-display text-xl font-extrabold uppercase text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]', /talent|time/i.test(w) && 'rounded bg-highlight px-1.5 text-[#1a1036]')}
            >
              {w}
            </motion.span>
          ))}
        </div>
      ) : (
        <p className="absolute inset-x-4 bottom-[20%] text-center text-sm text-white/60">{words.slice(0, i).join(' ')}</p>
      )}
      {!playing && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-white/15 text-white backdrop-blur">
            <Play className="h-6 w-6" />
          </span>
        </div>
      )}
    </div>
  );
}
