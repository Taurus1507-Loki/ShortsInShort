import { Shuffle } from 'lucide-react';
import { THEMES, resolveTheme } from '@/motion/themes';
import { useBrandKit } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** Colour theme for Motion Explainer videos: a fixed light/dark theme, the Brand Kit, or a different look per video. */
export function MotionThemePicker({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  const { data: kit } = useBrandKit();
  const brand = { primary: kit?.primaryColor, secondary: kit?.secondaryColor };
  const current = value ?? 'auto';
  const options = [
    { id: 'brand_light', name: 'Brand Kit · light', theme: resolveTheme('brand_light', brand) },
    { id: 'brand', name: 'Brand Kit · dark', theme: resolveTheme('brand', brand) },
    ...THEMES.map((t) => ({ id: t.id, name: t.name, theme: resolveTheme(t.id) })),
  ];
  return (
    <div className="grid gap-2" role="radiogroup" aria-label="Colour theme">
      <button
        type="button"
        role="radio"
        aria-checked={current === 'auto'}
        onClick={() => onChange('auto')}
        className={cn('flex items-center gap-3 rounded-lg border p-3 text-left text-sm', current === 'auto' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40')}
      >
        <Shuffle className="h-4 w-4 text-highlight" />
        <span>
          <span className="block font-semibold">Surprise me</span>
          <span className="text-xs text-muted-foreground">A different theme for each video, so your videos don’t all look the same</span>
        </span>
      </button>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={current === o.id}
            onClick={() => onChange(o.id)}
            title={`${o.name} (${o.theme.mode})`}
            className={cn('overflow-hidden rounded-lg border text-left text-xs transition-colors', current === o.id ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/40')}
          >
            <span className="relative block h-12" style={{ background: o.theme.background }}>
              <span className="absolute left-2 top-2 h-5 w-5 rounded-full" style={{ background: o.theme.primary }} />
              <span className="absolute left-5 top-4 h-5 w-5 rounded-full" style={{ background: o.theme.secondary }} />
              <span className="absolute bottom-2 right-2 h-1.5 w-8 rounded-full" style={{ background: o.theme.text, opacity: 0.7 }} />
            </span>
            <span className="block truncate px-2 py-1.5 font-medium">{o.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
