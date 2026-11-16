import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { flip } from '@remotion/transitions/flip';
import { clockWipe } from '@remotion/transitions/clock-wipe';
import { iris } from '@remotion/transitions/iris';
import { cube } from '@remotion/transitions/cube';

/**
 * Scene-to-scene transitions. Only CSS-based presentations: Remotion's WebGL ones rely on an
 * experimental Chrome feature that isn't reliable in headless server renders.
 */

type P = Record<string, never>;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Zooms through the old scene into the new one. */
const ZoomThrough: React.FC<TransitionPresentationComponentProps<P>> = ({ children, presentationDirection, presentationProgress }) => {
  const t = ease(presentationProgress);
  const entering = presentationDirection === 'entering';
  const scale = entering ? interpolate(t, [0, 1], [0.82, 1]) : interpolate(t, [0, 1], [1, 1.35]);
  const opacity = entering ? interpolate(t, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }) : interpolate(t, [0.4, 1], [1, 0], { extrapolateLeft: 'clamp' });
  return <AbsoluteFill style={{ transform: `scale(${scale})`, opacity }}>{children}</AbsoluteFill>;
};

/** Spins the new scene in while the old one spins away. */
const SpinZoom: React.FC<TransitionPresentationComponentProps<P>> = ({ children, presentationDirection, presentationProgress }) => {
  const t = ease(presentationProgress);
  const entering = presentationDirection === 'entering';
  const rot = entering ? interpolate(t, [0, 1], [-12, 0]) : interpolate(t, [0, 1], [0, 12]);
  const scale = entering ? interpolate(t, [0, 1], [0.6, 1]) : interpolate(t, [0, 1], [1, 1.4]);
  const opacity = entering ? Math.min(1, t * 2) : Math.min(1, (1 - t) * 2);
  return <AbsoluteFill style={{ transform: `rotate(${rot}deg) scale(${scale})`, opacity }}>{children}</AbsoluteFill>;
};

/** The new scene appears through horizontal blinds. */
const Blinds: React.FC<TransitionPresentationComponentProps<{ bars: number }>> = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  if (presentationDirection === 'exiting') return <AbsoluteFill>{children}</AbsoluteFill>;
  const t = ease(presentationProgress);
  const bar = 100 / passedProps.bars;
  const open = Math.min(bar, bar * t + 0.01);
  const mask = `repeating-linear-gradient(to bottom, black 0%, black ${open}%, transparent ${open}%, transparent ${bar}%)`;
  return <AbsoluteFill style={{ maskImage: mask, WebkitMaskImage: mask }}>{children}</AbsoluteFill>;
};

/** The new scene grows out of a diamond in the centre. */
const Diamond: React.FC<TransitionPresentationComponentProps<P>> = ({ children, presentationDirection, presentationProgress }) => {
  if (presentationDirection === 'exiting') return <AbsoluteFill>{children}</AbsoluteFill>;
  const r = ease(presentationProgress) * 110;
  return <AbsoluteFill style={{ clipPath: `polygon(50% ${50 - r}%, ${50 + r}% 50%, 50% ${50 + r}%, ${50 - r}% 50%)` }}>{children}</AbsoluteFill>;
};

/** The old scene splits in two and slides apart, revealing the new one. */
const Split: React.FC<TransitionPresentationComponentProps<{ vertical: boolean }>> = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  if (presentationDirection === 'entering') {
    const s = interpolate(ease(presentationProgress), [0, 1], [1.08, 1]);
    return <AbsoluteFill style={{ transform: `scale(${s})` }}>{children}</AbsoluteFill>;
  }
  const d = ease(presentationProgress) * 55;
  const v = passedProps.vertical;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: v ? 'inset(0 50% 0 0)' : 'inset(0 0 50% 0)', transform: v ? `translateX(-${d}%)` : `translateY(-${d}%)` }}>{children}</AbsoluteFill>
      <AbsoluteFill style={{ clipPath: v ? 'inset(0 0 0 50%)' : 'inset(50% 0 0 0)', transform: v ? `translateX(${d}%)` : `translateY(${d}%)` }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Slides in with a little overshoot and tilt (feels hand-animated). */
const SwingSlide: React.FC<TransitionPresentationComponentProps<{ from: 'left' | 'right' }>> = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  const p = presentationProgress;
  const back = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
  const dir = passedProps.from === 'left' ? -1 : 1;
  if (presentationDirection === 'entering') {
    const x = (1 - back(p)) * 100 * dir;
    return <AbsoluteFill style={{ transform: `translateX(${x}%) rotate(${(1 - p) * 6 * dir}deg)` }}>{children}</AbsoluteFill>;
  }
  return <AbsoluteFill style={{ transform: `translateX(${-ease(p) * 35 * dir}%) scale(${1 - ease(p) * 0.1})`, opacity: 1 - ease(p) * 0.6 }}>{children}</AbsoluteFill>;
};

const custom = <T extends Record<string, unknown>>(component: React.FC<TransitionPresentationComponentProps<T>>, props: T): TransitionPresentation<T> => ({ component, props });

export const TRANSITION_NAMES = ['zoom', 'spin', 'blinds', 'diamond', 'split', 'swing', 'slide', 'wipe', 'flip', 'cube', 'clock', 'iris', 'fade'] as const;
export type TransitionName = (typeof TRANSITION_NAMES)[number];

/** The presentation for a transition, oriented by `n` so neighbours differ. */
export function presentationFor(name: TransitionName, n: number, size: { width: number; height: number }): TransitionPresentation<Record<string, unknown>> {
  const dirs4 = ['from-right', 'from-bottom', 'from-left', 'from-top'] as const;
  const d = dirs4[n % 4]!;
  const any = (x: unknown) => x as TransitionPresentation<Record<string, unknown>>;
  switch (name) {
    case 'zoom':
      return any(custom(ZoomThrough, {}));
    case 'spin':
      return any(custom(SpinZoom, {}));
    case 'blinds':
      return any(custom(Blinds, { bars: 7 }));
    case 'diamond':
      return any(custom(Diamond, {}));
    case 'split':
      return any(custom(Split, { vertical: n % 2 === 0 }));
    case 'swing':
      return any(custom(SwingSlide, { from: (n % 2 ? 'left' : 'right') as 'left' | 'right' }));
    case 'slide':
      return any(slide({ direction: d }));
    case 'wipe':
      return any(wipe({ direction: (['from-left', 'from-top-left', 'from-bottom-right', 'from-right'] as const)[n % 4] }));
    case 'flip':
      return any(flip({ direction: d, perspective: 2000 }));
    case 'cube':
      return any(cube({ direction: d === 'from-top' || d === 'from-bottom' ? 'from-right' : d, perspective: 2400 }));
    case 'clock':
      return any(clockWipe(size));
    case 'iris':
      return any(iris(size));
    default:
      return any(fade());
  }
}

/** A different, good-looking transition for each cut; never the same one twice in a row. */
export function pickTransition(seed: number, i: number): TransitionName {
  const pool: TransitionName[] = ['zoom', 'swing', 'split', 'cube', 'diamond', 'slide', 'spin', 'wipe', 'blinds', 'flip', 'iris', 'clock'];
  return pool[(seed + i * 5) % pool.length]!;
}
