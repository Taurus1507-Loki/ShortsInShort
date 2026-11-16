import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { MotionTheme } from './themes';

/**
 * Scene backgrounds. Each scene gets its own (chosen per project), so a video never sits on one
 * background. Everything is gradients and simple shapes: CSS blur filters this large made every
 * frame very slow to render.
 */
export const BACKDROPS = ['glow', 'mesh', 'grid', 'dots', 'aurora', 'diagonal', 'spotlight', 'waves', 'rings'] as const;
export type BackdropId = (typeof BACKDROPS)[number];

const a = (hex: string, alpha: number) => `${hex}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')}`;

export function Backdrop({ id, theme }: { id: BackdropId; theme: MotionTheme }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const s = Math.max(width, height);
  const light = theme.mode === 'light';
  // Light themes need softer colour washes, dark ones a little more glow.
  const k = light ? 0.8 : 1;
  const line = light ? 'rgba(15,23,42,0.07)' : 'rgba(255,255,255,0.06)';
  const drift = (p: number, amp: number) => Math.sin(frame / p) * amp;

  switch (id) {
    case 'glow': {
      const x1 = interpolate(Math.sin(frame / 80), [-1, 1], [-0.15, 0.25]) * width;
      const y1 = interpolate(Math.cos(frame / 95), [-1, 1], [-0.1, 0.2]) * height;
      const x2 = interpolate(Math.cos(frame / 70), [-1, 1], [0.55, 0.85]) * width;
      const y2 = interpolate(Math.sin(frame / 85), [-1, 1], [0.6, 0.9]) * height;
      return (
        <AbsoluteFill style={{ background: theme.background }}>
          <div style={{ position: 'absolute', left: x1 - s * 0.5, top: y1 - s * 0.5, width: s, height: s, background: `radial-gradient(circle, ${a(theme.primary, 0.36 * k)} 0%, ${a(theme.primary, 0)} 62%)` }} />
          <div style={{ position: 'absolute', left: x2 - s * 0.45, top: y2 - s * 0.45, width: s * 0.9, height: s * 0.9, background: `radial-gradient(circle, ${a(theme.secondary, 0.28 * k)} 0%, ${a(theme.secondary, 0)} 62%)` }} />
        </AbsoluteFill>
      );
    }
    case 'mesh':
      return (
        <AbsoluteFill
          style={{
            background: [
              `radial-gradient(at ${20 + drift(90, 6)}% ${15 + drift(110, 5)}%, ${a(theme.primary, 0.42 * k)} 0px, transparent 45%)`,
              `radial-gradient(at ${85 + drift(100, 5)}% ${25 + drift(80, 6)}%, ${a(theme.secondary, 0.38 * k)} 0px, transparent 45%)`,
              `radial-gradient(at ${70 + drift(120, 6)}% ${88 + drift(95, 4)}%, ${a(theme.primary, 0.3 * k)} 0px, transparent 50%)`,
              `radial-gradient(at ${10 + drift(85, 5)}% ${80 + drift(105, 5)}%, ${a(theme.secondary, 0.26 * k)} 0px, transparent 50%)`,
              theme.background,
            ].join(', '),
          }}
        />
      );
    case 'grid': {
      const cell = s * 0.06;
      const off = (frame * 0.6) % cell;
      return (
        <AbsoluteFill style={{ background: theme.background }}>
          <AbsoluteFill
            style={{
              backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
              backgroundSize: `${cell}px ${cell}px`,
              backgroundPosition: `0 ${off}px`,
              maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
              WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
            }}
          />
          <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 0%, ${a(theme.primary, 0.3 * k)}, transparent 60%)` }} />
        </AbsoluteFill>
      );
    }
    case 'dots':
      return (
        <AbsoluteFill style={{ background: `linear-gradient(160deg, ${a(theme.primary, 0.14 * k)}, ${theme.background} 45%, ${a(theme.secondary, 0.16 * k)})`, backgroundColor: theme.background }}>
          <AbsoluteFill style={{ backgroundImage: `radial-gradient(${light ? 'rgba(15,23,42,0.13)' : 'rgba(255,255,255,0.09)'} ${s * 0.0018}px, transparent ${s * 0.002}px)`, backgroundSize: `${s * 0.028}px ${s * 0.028}px`, backgroundPosition: `${frame * 0.3}px ${frame * 0.15}px` }} />
        </AbsoluteFill>
      );
    case 'aurora': {
      const r = frame * 0.25;
      return (
        <AbsoluteFill style={{ background: theme.background, overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: s * 1.6,
              height: s * 1.6,
              transform: `translate(-50%, -50%) rotate(${r}deg)`,
              background: `conic-gradient(from 0deg, ${a(theme.primary, 0.32 * k)}, transparent 25%, ${a(theme.secondary, 0.3 * k)} 50%, transparent 75%, ${a(theme.primary, 0.32 * k)})`,
            }}
          />
          <AbsoluteFill style={{ background: `radial-gradient(circle at center, transparent 0%, ${theme.background} 72%)` }} />
        </AbsoluteFill>
      );
    }
    case 'diagonal': {
      const shift = drift(70, s * 0.02);
      return (
        <AbsoluteFill style={{ background: theme.background, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: -s * 0.3, top: height * 0.55 + shift, width: s * 1.8, height: s * 0.22, transform: 'rotate(-14deg)', background: `linear-gradient(90deg, ${a(theme.primary, 0.3 * k)}, ${a(theme.secondary, 0.3 * k)})` }} />
          <div style={{ position: 'absolute', left: -s * 0.3, top: height * 0.08 - shift, width: s * 1.8, height: s * 0.06, transform: 'rotate(-14deg)', background: a(theme.secondary, 0.22 * k) }} />
        </AbsoluteFill>
      );
    }
    case 'spotlight': {
      const sway = drift(60, 6);
      return (
        <AbsoluteFill style={{ background: theme.background, overflow: 'hidden' }}>
          <AbsoluteFill style={{ background: `conic-gradient(from ${180 - 22 + sway}deg at 50% -10%, transparent 0deg, ${a(theme.primary, 0.28 * k)} 22deg, transparent 44deg)` }} />
          <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 100%, ${a(theme.secondary, 0.22 * k)}, transparent 55%)` }} />
        </AbsoluteFill>
      );
    }
    case 'waves': {
      const w = (phase: number, amp: number, yFrac: number) => {
        const pts: string[] = [];
        for (let i = 0; i <= 24; i++) {
          const x = (i / 24) * width;
          const y = height * yFrac + Math.sin(i / 3 + frame / 22 + phase) * amp;
          pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
        return `M0,${height} L${pts.join(' L')} L${width},${height} Z`;
      };
      return (
        <AbsoluteFill style={{ background: theme.background }}>
          <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
            <path d={w(0, s * 0.02, 0.78)} fill={a(theme.primary, 0.22 * k)} />
            <path d={w(2, s * 0.025, 0.84)} fill={a(theme.secondary, 0.2 * k)} />
            <path d={w(4, s * 0.015, 0.9)} fill={a(theme.primary, 0.18 * k)} />
          </svg>
        </AbsoluteFill>
      );
    }
    case 'rings':
    default: {
      const ring = s * 0.05;
      const grow = (frame * 0.5) % ring;
      return (
        <AbsoluteFill style={{ background: theme.background, overflow: 'hidden' }}>
          <AbsoluteFill
            style={{
              backgroundImage: `repeating-radial-gradient(circle at 85% 15%, transparent 0px, transparent ${grow}px, ${a(theme.primary, 0.14 * k)} ${grow + 2}px, transparent ${grow + 4}px, transparent ${ring}px)`,
            }}
          />
          <AbsoluteFill style={{ background: `radial-gradient(circle at 15% 85%, ${a(theme.secondary, 0.26 * k)}, transparent 45%)` }} />
        </AbsoluteFill>
      );
    }
  }
}
