/**
 * Motion Explainer colour themes (light and dark). Shared by the live preview, the Style step's picker
 * and the server render (the server sends only a theme id plus the Brand Kit colours).
 */
export interface ThemePalette {
  id: string;
  name: string;
  mode: 'light' | 'dark';
  primary: string;
  secondary: string;
  background: string;
  text: string;
  muted: string;
}

export const THEMES: ThemePalette[] = [
  // Light
  { id: 'cream', name: 'Cream', mode: 'light', primary: '#EA580C', secondary: '#DB2777', background: '#FFF8EE', text: '#1F1A14', muted: '#7C6F60' },
  { id: 'mint', name: 'Mint', mode: 'light', primary: '#059669', secondary: '#0284C7', background: '#ECFDF5', text: '#052E25', muted: '#4B6B61' },
  { id: 'lavender', name: 'Lavender', mode: 'light', primary: '#7C3AED', secondary: '#DB2777', background: '#F5F3FF', text: '#1E1B4B', muted: '#6B6894' },
  { id: 'peach', name: 'Peach', mode: 'light', primary: '#C2410C', secondary: '#E11D48', background: '#FFF1EC', text: '#3B1D12', muted: '#8A6458' },
  { id: 'sky', name: 'Sky', mode: 'light', primary: '#2563EB', secondary: '#0891B2', background: '#EFF6FF', text: '#0B1B3A', muted: '#5B6B86' },
  { id: 'paper', name: 'Paper', mode: 'light', primary: '#111827', secondary: '#D97706', background: '#FAFAF7', text: '#111111', muted: '#6B6B6B' },
  // Dark
  { id: 'midnight', name: 'Midnight', mode: 'dark', primary: '#7C3AED', secondary: '#22D3EE', background: '#0B0B1A', text: '#FFFFFF', muted: '#A1A1AA' },
  { id: 'sunset', name: 'Sunset', mode: 'dark', primary: '#F43F5E', secondary: '#F59E0B', background: '#1A0B12', text: '#FFFFFF', muted: '#C4A9B2' },
  { id: 'forest', name: 'Forest', mode: 'dark', primary: '#10B981', secondary: '#A3E635', background: '#06140F', text: '#F0FDF4', muted: '#9AB8A8' },
  { id: 'ocean', name: 'Ocean', mode: 'dark', primary: '#0EA5E9', secondary: '#818CF8', background: '#04121C', text: '#F0F9FF', muted: '#94A9BA' },
];

/** What a project can choose: a fixed theme, the Brand Kit colours (light or dark), or "auto". */
export const THEME_CHOICES = ['auto', 'brand', 'brand_light', ...THEMES.map((t) => t.id)] as const;

export interface MotionTheme {
  mode: 'light' | 'dark';
  primary: string;
  secondary: string;
  background: string;
  text: string;
  muted: string;
  /** Card / panel fill and its outline (translucent, mode-aware). */
  surface: string;
  border: string;
  /** Text drawn on the primary→secondary gradient. */
  onAccent: string;
}

const hex = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);
const mix = (a: string, b: string, t: number) => {
  const x = a.match(/[0-9a-f]{2}/gi)!.map((v) => parseInt(v, 16));
  const y = b.match(/[0-9a-f]{2}/gi)!.map((v) => parseInt(v, 16));
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

/** Finishes a palette with the mode-aware surface, border and on-accent colours. */
export function finishTheme(p: Omit<ThemePalette, 'id' | 'name'>): MotionTheme {
  const light = p.mode === 'light';
  return {
    ...p,
    surface: light ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.07)',
    border: light ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.13)',
    onAccent: '#FFFFFF',
  };
}

/** Stable small number from a string (picks "auto" themes, backdrops and transitions per project). */
export function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Resolves a theme choice. "auto" picks a theme from the project's seed, so different videos get
 * different looks; "brand" keeps the Brand Kit colours on a dark base, "brand_light" on a light one.
 */
export function resolveTheme(choice: string | undefined, brand?: { primary?: string; secondary?: string } | null, seed = 0): MotionTheme {
  const primary = brand?.primary && hex(brand.primary) ? brand.primary : '#7C3AED';
  const secondary = brand?.secondary && hex(brand.secondary) ? brand.secondary : '#22D3EE';
  if (choice === 'brand') return finishTheme({ mode: 'dark', primary, secondary, background: mix(primary, '#05050A', 0.9), text: '#FFFFFF', muted: '#A1A1AA' });
  if (choice === 'brand_light') return finishTheme({ mode: 'light', primary, secondary, background: mix(primary, '#FFFFFF', 0.94), text: '#14121F', muted: '#666277' });
  const fixed = THEMES.find((t) => t.id === choice);
  return finishTheme(fixed ?? THEMES[seed % THEMES.length]!);
}
