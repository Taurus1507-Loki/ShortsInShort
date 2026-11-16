import React from 'react';
import { AbsoluteFill, Composition, useVideoConfig } from 'remotion';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { SceneView } from './scenes';
import { Backdrop, BACKDROPS } from './backdrops';
import { CaptionLayer } from './captions';
import { pickSticker, Sticker } from './lottie';
import { pickTransition, presentationFor } from './transitions';
import { finishTheme, resolveTheme, type MotionTheme } from './themes';
import { FONT_STACK, MOTION_FPS, type MotionProps } from './types';

/** The theme for these props (a theme choice, or a finished theme from older renders). */
export function themeFor(p: Pick<MotionProps, 'themeId' | 'brand' | 'theme' | 'seed'>): MotionTheme {
  if (!p.themeId && p.theme?.primary) {
    const t = p.theme;
    return finishTheme({ mode: t.mode ?? 'dark', primary: t.primary!, secondary: t.secondary ?? t.primary!, background: t.background ?? '#0B0B1A', text: t.text ?? '#FFFFFF', muted: t.muted ?? '#A1A1AA' });
  }
  return resolveTheme(p.themeId, p.brand, p.seed ?? 0);
}

/** Transition length between two scenes: up to 0.6 s, but never more than a third of either scene. */
const transitionFrames = (a: number, b: number) => {
  const t = Math.floor(Math.min(18, a / 3, b / 3));
  return t >= 6 ? t : 0;
};

/**
 * The whole explainer. Each scene has its own background and slides, zooms or flips into the next.
 * Timing stays locked to the voiceover: the outgoing scene is extended by the transition length, so
 * every scene starts exactly when its words do and the video keeps the voiceover's length.
 */
export const MotionVideo: React.FC<MotionProps> = (props) => {
  const { scenes, fontFamily, seed = 0, transitions = true, stickers = true, captions } = props;
  const { width, height } = useVideoConfig();
  const theme = themeFor(props);
  const lens = scenes.map((sc) => Math.max(1, Math.round(sc.durationInFrames)));
  const cuts = lens.map((len, i) => (transitions && i < lens.length - 1 ? transitionFrames(len, lens[i + 1]!) : 0));
  let lastBackdrop = -1;
  const backdropIndex = scenes.map((_, i) => {
    let b = (seed + i * 4) % BACKDROPS.length;
    if (b === lastBackdrop) b = (b + 1) % BACKDROPS.length;
    lastBackdrop = b;
    return b;
  });

  return (
    <AbsoluteFill style={{ fontFamily: fontFamily ?? FONT_STACK, background: theme.background }}>
      <TransitionSeries>
        {scenes.map((sc, i) => {
          const sticker = stickers ? pickSticker(sc, i, seed) : null;
          return (
            <React.Fragment key={i}>
              <TransitionSeries.Sequence durationInFrames={lens[i]! + cuts[i]!}>
                <Backdrop id={BACKDROPS[backdropIndex[i]!]!} theme={theme} />
                <SceneView scene={sc} theme={theme} />
                {sticker && <Sticker name={sticker} index={i} />}
              </TransitionSeries.Sequence>
              {cuts[i]! > 0 && (
                <TransitionSeries.Transition presentation={presentationFor(pickTransition(seed, i), i, { width, height })} timing={linearTiming({ durationInFrames: cuts[i]! })} />
              )}
            </React.Fragment>
          );
        })}
      </TransitionSeries>
      {captions && captions.lines.length > 0 && <CaptionLayer track={captions} theme={theme} />}
    </AbsoluteFill>
  );
};

export const DEFAULT_MOTION_PROPS: MotionProps = {
  scenes: [{ template: 'title', params: { eyebrow: 'Preview', headline: 'Motion Explainer' }, durationInFrames: 60 }],
  themeId: 'midnight',
};

/** Registered for server rendering; size and length come from the input props. */
export const MotionRoot: React.FC = () => (
  <Composition
    id="MotionVideo"
    component={MotionVideo}
    fps={MOTION_FPS}
    width={1080}
    height={1920}
    durationInFrames={60}
    defaultProps={DEFAULT_MOTION_PROPS}
    calculateMetadata={({ props }) => {
      const p = props as MotionProps & { width?: number; height?: number };
      return {
        // Transitions overlap the extended scenes, so the length is simply the sum of the scenes.
        durationInFrames: Math.max(1, p.scenes.reduce((t, s) => t + Math.max(1, Math.round(s.durationInFrames)), 0)),
        width: typeof p.width === 'number' ? p.width : 1080,
        height: typeof p.height === 'number' ? p.height : 1920,
      };
    }}
  />
);
