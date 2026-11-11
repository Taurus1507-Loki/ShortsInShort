import React from 'react';
import { AbsoluteFill, Composition, interpolate, Series, useCurrentFrame, useVideoConfig } from 'remotion';
import { SceneView } from './scenes';
import { FONT_STACK, MOTION_FPS, type MotionProps } from './types';

/** Slowly drifting glow blobs behind every scene, in the brand colours. */
function Backdrop({ primary, secondary, background }: { primary: string; secondary: string; background: string }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const s = Math.max(width, height);
  const x1 = interpolate(Math.sin(frame / 80), [-1, 1], [-0.15, 0.25]) * width;
  const y1 = interpolate(Math.cos(frame / 95), [-1, 1], [-0.1, 0.2]) * height;
  const x2 = interpolate(Math.cos(frame / 70), [-1, 1], [0.55, 0.85]) * width;
  const y2 = interpolate(Math.sin(frame / 85), [-1, 1], [0.6, 0.9]) * height;
  return (
    <AbsoluteFill style={{ background }}>
      {/* Soft glows as radial gradients — a CSS blur filter this large made every frame very slow to render. */}
      <div style={{ position: 'absolute', left: x1 - s * 0.5, top: y1 - s * 0.5, width: s, height: s, background: `radial-gradient(circle, ${primary}5c 0%, ${primary}00 62%)` }} />
      <div style={{ position: 'absolute', left: x2 - s * 0.45, top: y2 - s * 0.45, width: s * 0.9, height: s * 0.9, background: `radial-gradient(circle, ${secondary}47 0%, ${secondary}00 62%)` }} />
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: `${s * 0.03}px ${s * 0.03}px` }} />
    </AbsoluteFill>
  );
}

/** The whole explainer: one backdrop, scenes played back to back, each exactly as long as its narration. */
export const MotionVideo: React.FC<MotionProps> = ({ scenes, theme, fontFamily }) => (
  <AbsoluteFill style={{ fontFamily: fontFamily ?? FONT_STACK }}>
    <Backdrop primary={theme.primary} secondary={theme.secondary} background={theme.background} />
    <Series>
      {scenes.map((sc, i) => (
        <Series.Sequence key={i} durationInFrames={Math.max(1, Math.round(sc.durationInFrames))}>
          <SceneView scene={sc} theme={theme} />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);

export const DEFAULT_MOTION_PROPS: MotionProps = {
  scenes: [{ template: 'title', params: { eyebrow: 'Preview', headline: 'Motion Explainer' }, durationInFrames: 60 }],
  theme: { primary: '#7C3AED', secondary: '#22D3EE', background: '#0B0B1A', text: '#FFFFFF', muted: '#A1A1AA' },
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
        durationInFrames: Math.max(1, p.scenes.reduce((t, s) => t + Math.max(1, Math.round(s.durationInFrames)), 0)),
        width: typeof p.width === 'number' ? p.width : 1080,
        height: typeof p.height === 'number' ? p.height : 1920,
      };
    }}
  />
);
