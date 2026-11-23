import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CaptionTrack } from './types';
import type { MotionTheme } from './themes';

const SIZE: Record<CaptionTrack['size'], number> = { small: 0.8, medium: 1, large: 1.2, xl: 1.4 };
const BASE: Record<CaptionTrack['style'], number> = { bold_pop: 7.6, karaoke: 6.2, clean_minimal: 4.8, boxed: 5.6, cinematic: 4.4 };

/**
 * Word-timed captions drawn inside the animation, so they move with it: the spoken word pops,
 * keywords light up in the highlight colour, and each style has its own motion.
 */
export function CaptionLayer({ track, theme }: { track: CaptionTrack; theme: MotionTheme }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const line = track.lines.find((l) => t >= l.start && t < l.end + 0.05);
  if (!line) return null;
  const unit = Math.min(width, height) / 100;
  const fontSize = unit * BASE[track.style] * SIZE[track.size];
  const upper = track.style === 'bold_pop' || track.style === 'cinematic';
  const lineFrame = (t - line.start) * fps;
  const enter = spring({ frame: lineFrame, fps, config: { damping: 14, stiffness: 180, mass: 0.5 } });
  const hl = track.highlightColor || theme.secondary;
  // Light themes: white text with an outline still reads poorly on pastel backgrounds, so the line sits
  // on a dark rounded panel (like the Boxed style) — every caption style stays readable.
  const panel = track.style === 'boxed' || theme.mode === 'light';
  // Dark themes: white text with a dark outline and soft shadow.
  const outline = `${Math.max(3, fontSize * 0.11)}px`;
  const vertical = track.position === 'top' ? 'flex-start' : track.position === 'middle' ? 'center' : 'flex-end';
  const pad = height * (track.position === 'middle' ? 0 : 0.1);

  const words = line.words.map((w, i) => {
    const active = t >= w.start && t < w.end + 0.02;
    const spoken = t >= w.start;
    const key = line.keywords.includes(i);
    const wf = (t - w.start) * fps;
    const pop = active ? 1 + 0.12 * Math.max(0, 1 - wf / 6) : 1;
    let color = '#FFFFFF';
    let background = 'transparent';
    let opacity = 1;
    switch (track.style) {
      case 'bold_pop':
        color = key || active ? hl : '#FFFFFF';
        break;
      case 'karaoke':
        color = spoken ? (key ? hl : '#FFFFFF') : panel ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.45)';
        break;
      case 'boxed':
        background = active ? hl : 'transparent';
        color = active ? '#0B0B12' : key ? hl : '#FFFFFF';
        break;
      case 'clean_minimal':
        color = key ? hl : '#FFFFFF';
        opacity = spoken ? 1 : panel ? 0.7 : 0.55;
        break;
      case 'cinematic':
        opacity = interpolate(wf, [-2, 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        break;
    }
    return (
      <span
        key={i}
        style={{
          display: 'inline-block',
          color,
          opacity,
          background,
          borderRadius: fontSize * 0.18,
          padding: background !== 'transparent' ? `0 ${fontSize * 0.18}px` : 0,
          transform: `scale(${track.style === 'cinematic' ? 1 : pop})`,
          WebkitTextStroke: background !== 'transparent' || panel ? undefined : `${outline} #000000`,
          paintOrder: 'stroke fill',
        }}
      >
        {upper ? w.text.toUpperCase() : w.text}
      </span>
    );
  });

  return (
    <AbsoluteFill style={{ justifyContent: vertical, alignItems: 'center', paddingTop: pad, paddingBottom: pad, pointerEvents: 'none' }}>
      <div
        style={{
          maxWidth: width * 0.86,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: `${fontSize * 0.12}px ${fontSize * 0.28}px`,
          fontSize,
          fontWeight: track.style === 'clean_minimal' || track.style === 'cinematic' ? 700 : 900,
          letterSpacing: track.style === 'cinematic' ? fontSize * 0.12 : 0,
          lineHeight: 1.15,
          textAlign: 'center',
          textShadow: panel ? undefined : `0 ${fontSize * 0.07}px ${fontSize * 0.2}px rgba(0,0,0,0.55)`,
          transform: `translateY(${(1 - enter) * fontSize * 0.5}px) scale(${0.92 + 0.08 * enter})`,
          opacity: Math.min(1, enter * 1.5),
          ...(panel ? { background: 'rgba(10,10,18,0.8)', padding: `${fontSize * 0.25}px ${fontSize * 0.45}px`, borderRadius: fontSize * 0.35, boxShadow: `0 ${fontSize * 0.1}px ${fontSize * 0.4}px rgba(0,0,0,0.25)` } : {}),
        }}
      >
        {words}
      </div>
    </AbsoluteFill>
  );
}
