import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Lottie } from '@remotion/lottie';
import { AnimatedIcon, EMOJI, hasLineIcon } from './lottie';
import { FONT_STACK, type IconName } from './types';

/**
 * Motion graphics over real footage (AI Video Editor): an animated number counter, an animated emoji
 * pop-up and a callout card. The same component plays in the editor's live preview and is rendered
 * by the server (with a transparent background) for the export, so both look identical.
 */
export const GRAPHIC_EMOJI = ['fire', 'rocket', 'idea', 'mind_blown', 'hundred', 'heart_eyes', 'check', 'thumbs_up', 'eyes', 'party', 'celebrate', 'star', 'laughing', 'raised_hands', 'heart'] as const;
export type GraphicEmoji = (typeof GRAPHIC_EMOJI)[number];

export interface GraphicSpec {
  kind: 'counter' | 'emoji' | 'callout';
  /** counter */
  value?: number;
  prefix?: string;
  suffix?: string;
  /** counter / emoji: small line under the number or emoji */
  label?: string;
  emoji?: GraphicEmoji;
  /** callout */
  text?: string;
  heading?: string;
  icon?: IconName;
  position: 'top' | 'middle' | 'bottom';
  color: string;
}

const COUNT_SEC = 0.9;

/** The counter's number at a moment (0 → value, easing out), formatted like the speaker said it. */
export function counterText(g: Pick<GraphicSpec, 'value' | 'prefix' | 'suffix'>, progress: number) {
  const value = g.value ?? 0;
  const decimals = Math.min(2, (String(value).split('.')[1] ?? '').length);
  const n = value * Math.min(1, Math.max(0, progress));
  const locale = g.prefix === '₹' ? 'en-IN' : 'en-US';
  const num = n.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${g.prefix ?? ''}${num}${g.suffix ?? ''}`;
}

export function GraphicView({ g, durationInFrames }: { g: GraphicSpec; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const unit = Math.min(width, height) / 100;
  const enter = spring({ frame, fps, config: { damping: 12, stiffness: 170, mass: 0.7 } });
  const exit = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const portrait = height > width;
  const top = g.position === 'top' ? height * (portrait ? 0.2 : 0.12) : g.position === 'middle' ? height * 0.5 : height * (portrait ? 0.6 : 0.56);
  const anchor = g.position === 'middle' ? 'translateY(-50%)' : g.position === 'bottom' ? 'translateY(-100%)' : '';
  const box = {
    position: 'absolute' as const,
    left: '50%',
    top,
    transform: `translateX(-50%) ${anchor} scale(${(0.6 + 0.4 * enter) * (0.85 + 0.15 * exit)})`,
    opacity: Math.min(1, enter * 1.4) * exit,
    width: 'max-content',
    maxWidth: width * 0.86,
  };
  const card = {
    background: 'rgba(10,10,18,0.82)',
    border: `${Math.max(2, unit * 0.35)}px solid ${g.color}`,
    borderRadius: unit * 3.2,
    boxShadow: `0 ${unit * 1.2}px ${unit * 4}px rgba(0,0,0,0.45), 0 0 ${unit * 4}px ${g.color}55`,
    color: '#fff',
    fontFamily: FONT_STACK,
  };

  if (g.kind === 'counter') {
    const p = Easing.out(Easing.cubic)(Math.min(1, frame / (COUNT_SEC * fps)));
    const landed = frame >= COUNT_SEC * fps;
    const bump = landed ? 1 + 0.08 * Math.max(0, 1 - (frame - COUNT_SEC * fps) / 6) : 1;
    return (
      <AbsoluteFill>
        <div style={{ ...box }}>
          <div style={{ ...card, padding: `${unit * 2.6}px ${unit * 5.5}px`, textAlign: 'center' }}>
            <div style={{ fontSize: unit * 15, fontWeight: 900, lineHeight: 1, letterSpacing: -unit * 0.3, color: '#fff', textShadow: `0 0 ${unit * 3}px ${g.color}`, transform: `scale(${bump})`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {counterText(g, p)}
            </div>
            {g.label && (
              <div style={{ marginTop: unit * 1.4, fontSize: unit * 4.2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: unit * 0.35, color: g.color, opacity: interpolate(frame, [6, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
                {g.label}
              </div>
            )}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  if (g.kind === 'emoji') {
    const size = unit * 28;
    const data = EMOJI[g.emoji ?? 'fire'] ?? EMOJI.fire!;
    const wobble = Math.sin(frame / 7) * 5;
    return (
      <AbsoluteFill>
        <div style={{ ...box, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: size, height: size, transform: `rotate(${wobble}deg)`, filter: `drop-shadow(0 ${unit}px ${unit * 2}px rgba(0,0,0,0.4))` }}>
            <Lottie animationData={data} loop renderer="canvas" style={{ width: size, height: size }} />
          </div>
          {g.label && (
            <div style={{ marginTop: unit * 0.6, padding: `${unit * 1}px ${unit * 3}px`, borderRadius: 999, background: g.color, color: '#fff', fontSize: unit * 4.6, fontWeight: 800, whiteSpace: 'nowrap', fontFamily: FONT_STACK, boxShadow: `0 ${unit * 0.8}px ${unit * 2}px rgba(0,0,0,0.35)` }}>
              {g.label}
            </div>
          )}
        </div>
      </AbsoluteFill>
    );
  }

  // Callout: slides in, an accent bar on the left, optional icon and heading, underline sweep.
  const slide = interpolate(enter, [0, 1], [-unit * 14, 0]);
  const sweep = interpolate(frame, [8, 22], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const icon = g.icon && hasLineIcon(g.icon) ? g.icon : null;
  return (
    <AbsoluteFill>
      <div style={{ ...box, transform: `${box.transform} translateX(${slide}px)` }}>
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: unit * 2.6, padding: `${unit * 2.4}px ${unit * 4}px ${unit * 2.4}px ${unit * 2.6}px`, borderLeft: `${unit * 1.4}px solid ${g.color}` }}>
          {icon && (
            <div style={{ flexShrink: 0, width: unit * 11, height: unit * 11, borderRadius: unit * 2.4, background: `${g.color}33`, display: 'grid', placeItems: 'center' }}>
              <Sequence from={4} layout="none">
                <AnimatedIcon name={icon} size={unit * 8} color={g.color} />
              </Sequence>
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            {g.heading && <div style={{ fontSize: unit * 3.4, fontWeight: 800, textTransform: 'uppercase', letterSpacing: unit * 0.35, color: g.color, marginBottom: unit * 0.6 }}>{g.heading}</div>}
            <div style={{ fontSize: unit * 6.2, fontWeight: 850, lineHeight: 1.15 }}>{g.text}</div>
            <div style={{ marginTop: unit * 1, height: Math.max(2, unit * 0.6), width: `${sweep}%`, background: g.color, borderRadius: 99 }} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** One graphic, rendered alone with a transparent background (server export). */
export function GraphicClip({ graphic }: { graphic: GraphicSpec; width?: number; height?: number; durationInFrames?: number }) {
  const { durationInFrames } = useVideoConfig();
  return <GraphicView g={graphic} durationInFrames={durationInFrames} />;
}
