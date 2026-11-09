import type { CSSProperties } from 'react';
import { useAssetUrl, useBrandKit } from '@/lib/queries';
import { useAuth } from '@/features/auth/AuthProvider';
import { cn } from '@/lib/utils';
import type { AspectRatio, Asset, ProjectSettings } from '@/types/api';

/** Mirrors the server's caption specs (server/src/services/video/captions.ts). */
const STYLE: Record<ProjectSettings['captionStyle'], { size: number; uppercase: boolean; highlight: boolean; weight: number }> = {
  bold_pop: { size: 0.085, uppercase: true, highlight: true, weight: 900 },
  karaoke: { size: 0.068, uppercase: false, highlight: true, weight: 900 },
  clean_minimal: { size: 0.052, uppercase: false, highlight: true, weight: 600 },
  boxed: { size: 0.06, uppercase: false, highlight: true, weight: 900 },
  cinematic: { size: 0.048, uppercase: true, highlight: false, weight: 600 },
};
const SIZE_SCALE = { small: 0.8, medium: 1, large: 1.2, xl: 1.4 } as const;
const LOGO_W = { small: 0.12, medium: 0.18, large: 0.25 } as const;

/** Same rule as the server: blur only when the shapes differ by more than 1.5×. */
export function resolveFraming(setting: ProjectSettings['framing'], source: { width: number; height: number } | null, aspect: AspectRatio): 'crop' | 'blur' {
  if (setting !== 'auto') return setting;
  if (!source) return 'crop';
  const [aw, ah] = aspect.split(':').map(Number) as [number, number];
  const ratio = source.width / source.height / (aw / ah);
  return Math.max(ratio, 1 / ratio) > 1.5 ? 'blur' : 'crop';
}

/**
 * Live, approximate preview of the final frame: framing, captions (style, size, position, highlight),
 * Brand Kit logo and the Free-plan watermark — built from a real frame of the uploaded video.
 */
export function LivePreview({
  aspect,
  settings,
  source,
  sampleText,
}: {
  aspect: AspectRatio;
  settings: ProjectSettings;
  source: Asset | null | undefined;
  sampleText?: string;
}) {
  const poster = useAssetUrl(source?.thumbnailAssetId);
  const { data: kit } = useBrandKit();
  const logoUrl = useAssetUrl(settings.useBrandKit !== false ? kit?.logo?.id : null);
  const { workspace } = useAuth();

  const [aw, ah] = aspect.split(':').map(Number) as [number, number];
  const W = 260;
  const H = Math.round((W * ah) / aw);
  const short = Math.min(W, H);
  const framing = resolveFraming(settings.framing ?? 'auto', source && source.width && source.height ? { width: source.width, height: source.height } : null, aspect);
  const spec = STYLE[settings.captionStyle ?? 'bold_pop'];
  const fontSize = short * spec.size * SIZE_SCALE[settings.captionSize ?? 'medium'];
  const landscape = W > H;

  const words = (sampleText?.trim() || 'Your captions will look like this').split(/\s+/).slice(0, spec.uppercase ? 3 : 5);
  const keyIdx = spec.highlight ? words.reduce((best, w, i) => (w.replace(/\W/g, '').length > (words[best]?.replace(/\W/g, '').length ?? 0) ? i : best), 0) : -1;

  const posStyle: CSSProperties =
    settings.captionPosition === 'top'
      ? { top: H * 0.12 }
      : settings.captionPosition === 'middle'
        ? { top: '50%', transform: 'translateY(-50%)' }
        : { bottom: H * (landscape ? 0.1 : 0.22) };
  const textStyle: CSSProperties = {
    fontSize,
    fontWeight: spec.weight,
    letterSpacing: settings.captionStyle === 'cinematic' ? fontSize * 0.12 : undefined,
    textTransform: spec.uppercase ? 'uppercase' : undefined,
    lineHeight: 1.15,
    color: '#fff',
    textShadow: settings.captionStyle === 'boxed' ? undefined : '0 0 2px #000, 0 0 2px #000, 0 2px 4px #000',
  };
  const corner = kit
    ? { 'top-left': { left: '4%', top: '4%' }, 'top-right': { right: '4%', top: '4%' }, 'bottom-left': { left: '4%', bottom: '4%' }, 'bottom-right': { right: '4%', bottom: '4%' } }[kit.logoPosition]
    : {};

  return (
    <figure className="grid gap-2">
      <div className="relative mx-auto overflow-hidden rounded-xl border border-border bg-black shadow-soft" style={{ width: W, height: H }} aria-label="Preview of the final video frame">
        {poster.data ? (
          framing === 'blur' ? (
            <>
              <img src={poster.data} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover blur-md brightness-90" />
              <img src={poster.data} alt="" className="absolute inset-0 h-full w-full object-contain" />
            </>
          ) : (
            <img src={poster.data} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900" />
        )}

        {settings.captionsEnabled && (
          <div className="absolute inset-x-[8%] text-center" style={posStyle}>
            <span className={cn(settings.captionStyle === 'boxed' && 'rounded bg-black/60 px-1.5 py-0.5')} style={textStyle}>
              {words.map((w, i) => (
                <span key={i} style={i === keyIdx ? { color: settings.highlightColor } : undefined}>
                  {w}
                  {i < words.length - 1 ? ' ' : ''}
                </span>
              ))}
            </span>
          </div>
        )}
        {logoUrl.data && kit && <img src={logoUrl.data} alt="" className="absolute h-auto" style={{ ...corner, width: W * LOGO_W[kit.logoSize], opacity: kit.logoOpacity }} />}
        {workspace?.plan === 'free' && (
          <span className="absolute font-semibold text-white/60" style={{ top: short * 0.035, right: short * 0.035, fontSize: Math.max(7, short * 0.03), textShadow: '0 0 2px #000' }}>
            Made with ShortsInShort
          </span>
        )}
      </div>
      <figcaption className="text-center text-xs text-muted-foreground">
        {source?.thumbnailAssetId ? 'Live preview from your video' : 'Live preview'} · {framing === 'blur' ? 'blurred background' : 'fill frame'} · approximate
      </figcaption>
    </figure>
  );
}
