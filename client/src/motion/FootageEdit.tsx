import { AbsoluteFill, Html5Audio, Html5Video, Img, interpolate, Series, useCurrentFrame, useVideoConfig } from 'remotion';
import { CaptionLayer } from './captions';
import { finishTheme } from './themes';
import type { CaptionTrack } from './types';

/**
 * Live preview of an AI Video Editor timeline, played in the browser: the kept segments of the real
 * footage back to back, framing (fill or blurred background), punch-in zooms, word-timed captions,
 * text overlays, Brand Kit logo and the Free-plan mark. The export (FFmpeg) renders the same edit.
 * All times here are seconds on the EDITED timeline except `segments` (source seconds).
 */
export interface FootageEditProps {
  src: string;
  segments: Array<{ start: number; end: number }>;
  framing: 'crop' | 'blur';
  zooms: Array<{ start: number; end: number; scale: number }>;
  texts: Array<{ start: number; end: number; text: string; position: 'top' | 'middle' | 'bottom'; style?: 'outline' | 'box' | 'accent'; size?: 's' | 'm' | 'l'; color?: string }>;
  captions: CaptionTrack | null;
  logo: { url: string; position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; widthFrac: number; opacity: number } | null;
  watermark: boolean;
  /** B-roll cutaways (edited-timeline seconds). The preview shows the clip's still; the export uses the clip. */
  broll?: Array<{ start: number; end: number; image: string | null }>;
  /** Background music, dipped while someone speaks (`speech` = edited-timeline ranges). */
  music?: { src: string; volume: number; duck: boolean; speech: Array<{ start: number; end: number }> } | null;
  [key: string]: unknown;
}

const CAPTION_THEME = finishTheme({ mode: 'dark', primary: '#7C3AED', secondary: '#22D3EE', background: '#000000', text: '#FFFFFF', muted: '#A1A1AA' });

function zoomAt(t: number, zooms: FootageEditProps['zooms']) {
  for (const z of zooms) {
    if (t < z.start || t > z.end) continue;
    // Ease in over 0.25 s, hold, ease out — the same punch-in feel as the export.
    const ramp = Math.min(0.25, (z.end - z.start) / 3);
    const k = interpolate(t, [z.start, z.start + ramp, z.end - ramp, z.end], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return 1 + (z.scale - 1) * k;
  }
  return 1;
}

export function FootageEdit({ src, segments, framing, zooms, texts, captions, logo, watermark, broll = [], music = null }: FootageEditProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const scale = zoomAt(t, zooms);
  const short = Math.min(width, height);
  const fit = framing === 'blur' ? 'contain' : 'cover';
  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <Series>
          {segments.map((s, i) => (
            <Series.Sequence key={`${s.start}-${i}`} durationInFrames={Math.max(1, Math.round((s.end - s.start) * fps))}>
              {framing === 'blur' && (
                <AbsoluteFill style={{ filter: 'blur(24px) brightness(0.85)', transform: 'scale(1.15)' }}>
                  <Html5Video src={src} trimBefore={Math.round(s.start * fps)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </AbsoluteFill>
              )}
              <Html5Video src={src} trimBefore={Math.round(s.start * fps)} style={{ width: '100%', height: '100%', objectFit: fit }} />
            </Series.Sequence>
          ))}
        </Series>
      </AbsoluteFill>
      {broll
        .filter((b) => t >= b.start && t < b.end)
        .map((b, i) => (
          <AbsoluteFill key={`b${i}`} style={{ background: '#111', overflow: 'hidden' }}>
            {b.image ? (
              <Img
                src={b.image}
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${interpolate(t, [b.start, b.end], [1.04, 1.14])})` }}
              />
            ) : null}
            <div style={{ position: 'absolute', left: short * 0.03, bottom: short * 0.03, padding: `${short * 0.006}px ${short * 0.014}px`, borderRadius: short * 0.008, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: short * 0.024, fontWeight: 600 }}>
              B-roll (still preview)
            </div>
          </AbsoluteFill>
        ))}
      {music && music.src && (
        <Html5Audio
          src={music.src}
          loop
          volume={(f) => {
            const sec = f / fps;
            const talking = music.duck && music.speech.some((r) => sec >= r.start - 0.15 && sec <= r.end + 0.25);
            return music.volume * (talking ? 0.45 : 1);
          }}
        />
      )}
      {texts
        .filter((x) => t >= x.start && t <= x.end)
        .map((x, i) => (
          <AbsoluteFill key={i} style={{ justifyContent: x.position === 'top' ? 'flex-start' : x.position === 'middle' ? 'center' : 'flex-end', alignItems: 'center', padding: `${height * 0.14}px ${width * 0.08}px` }}>
            <div
              style={{
                // Same looks as the export: outline (coloured text, black edge), dark box, or coloured box.
                color: x.style === 'box' || x.style === 'accent' ? '#fff' : (x.color ?? '#fff'),
                background: x.style === 'box' ? 'rgba(11,11,18,0.81)' : x.style === 'accent' ? (x.color ?? '#7C3AED') : undefined,
                padding: x.style === 'box' || x.style === 'accent' ? `${short * 0.012}px ${short * 0.022}px` : undefined,
                borderRadius: x.style === 'box' || x.style === 'accent' ? short * 0.01 : undefined,
                fontWeight: 900,
                fontSize: short * (x.size === 's' ? 0.05 : x.size === 'l' ? 0.09 : x.style === 'box' || x.style === 'accent' ? 0.062 : 0.068),
                textAlign: 'center',
                lineHeight: 1.15,
                WebkitTextStroke: x.style === 'box' || x.style === 'accent' ? undefined : `${Math.max(2, short * 0.006)}px #000`,
                paintOrder: 'stroke fill',
                opacity: interpolate(t, [x.start, x.start + 0.2, x.end - 0.2, x.end], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
              }}
            >
              {x.text}
            </div>
          </AbsoluteFill>
        ))}
      {captions && captions.lines.length > 0 && <CaptionLayer track={captions} theme={CAPTION_THEME} />}
      {logo && (
        <img
          src={logo.url}
          alt=""
          style={{
            position: 'absolute',
            width: width * logo.widthFrac,
            opacity: logo.opacity,
            [logo.position.includes('top') ? 'top' : 'bottom']: short * 0.04,
            [logo.position.includes('left') ? 'left' : 'right']: short * 0.04,
          }}
        />
      )}
      {watermark && (
        <div style={{ position: 'absolute', top: short * 0.035, right: short * 0.035, color: 'rgba(255,255,255,0.6)', fontWeight: 600, fontSize: short * 0.03, textShadow: '0 0 2px #000' }}>Made with ShortsInShort</div>
      )}
    </AbsoluteFill>
  );
}
