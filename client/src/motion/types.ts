/**
 * Motion Explainer data contract, shared by the live preview (browser) and the server render.
 * The server validates every scene against the same shapes (zod) before rendering.
 */
export const ICONS = [
  'sparkles', 'brain', 'cpu', 'bot', 'message', 'image', 'video', 'music', 'file', 'lightbulb',
  'rocket', 'trending', 'chart', 'pie', 'money', 'coins', 'wallet', 'cart', 'users', 'user',
  'heart', 'star', 'clock', 'calendar', 'globe', 'pin', 'home', 'building', 'briefcase', 'school',
  'book', 'code', 'phone', 'laptop', 'camera', 'zap', 'shield', 'lock', 'check', 'target',
  'leaf', 'sun', 'coffee', 'fitness', 'food', 'plane', 'car', 'gift',
] as const;
export type IconName = (typeof ICONS)[number];

export interface TitleParams { eyebrow?: string; headline: string }
export interface StatementParams { text: string; highlight?: string }
export interface StatParams { value: string; label: string }
export interface BulletsParams { title?: string; items: string[] }
export interface CardsParams { title?: string; cards: Array<{ icon: IconName; label: string }> }
export interface ProcessParams { steps: Array<{ icon: IconName; label: string }> }
export interface CompareParams { leftTitle: string; leftPoints: string[]; rightTitle: string; rightPoints: string[] }
export interface ChatParams { prompt: string; reply: string }
export interface OrbitParams { centerIcon: IconName; label: string; icons: IconName[] }
export interface CtaParams { headline: string; action: string }

export type MotionScene =
  | { template: 'title'; params: TitleParams }
  | { template: 'statement'; params: StatementParams }
  | { template: 'stat'; params: StatParams }
  | { template: 'bullets'; params: BulletsParams }
  | { template: 'cards'; params: CardsParams }
  | { template: 'process'; params: ProcessParams }
  | { template: 'compare'; params: CompareParams }
  | { template: 'chat'; params: ChatParams }
  | { template: 'orbit'; params: OrbitParams }
  | { template: 'cta'; params: CtaParams };

export type TemplateId = MotionScene['template'];

export const TEMPLATES: Array<{ id: TemplateId; name: string; use: string }> = [
  { id: 'title', name: 'Title card', use: 'Opening hook or section heading' },
  { id: 'statement', name: 'Statement', use: 'One strong sentence with a highlighted word' },
  { id: 'stat', name: 'Big number', use: 'A statistic or figure that counts up' },
  { id: 'bullets', name: 'List', use: '2–4 short points appearing one by one' },
  { id: 'cards', name: 'Card grid', use: '2–4 things, each with an icon' },
  { id: 'process', name: 'Process', use: '2–4 steps connected by arrows' },
  { id: 'compare', name: 'Comparison', use: 'Two sides: before/after, this vs that' },
  { id: 'chat', name: 'Chat', use: 'A question typed and an answer appearing' },
  { id: 'orbit', name: 'Icon orbit', use: 'A central idea with related icons around it' },
  { id: 'cta', name: 'Call to action', use: 'Closing line: follow, subscribe, try it' },
];

export interface MotionTheme {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  muted: string;
}

export interface MotionProps {
  scenes: Array<MotionScene & { durationInFrames: number }>;
  theme: MotionTheme;
  /** CSS font stack (Latin + Indic). */
  fontFamily?: string;
  [key: string]: unknown;
}

export const MOTION_FPS = 30;
export const FONT_STACK = '"Inter", "Segoe UI", "Noto Sans", "Nirmala UI", "Noto Sans Devanagari", "Noto Sans Telugu", "Noto Sans Tamil", system-ui, sans-serif';
