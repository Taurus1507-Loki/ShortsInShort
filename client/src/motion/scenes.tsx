import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import {
  ArrowRight, BarChart3, BookOpen, Bot, Brain, Briefcase, Building2, Calendar, Camera, Car, CheckCircle2, Clock, Code, Coffee, Coins,
  Cpu, DollarSign, Dumbbell, FileText, Gift, Globe, GraduationCap, Heart, Home, Image, Laptop, Leaf, Lightbulb, Lock, MapPin, MessageSquare,
  Music, PieChart, Plane, Rocket, Shield, ShoppingCart, Smartphone, Sparkles, Star, Sun, Target, TrendingUp, User, Users, Utensils, Video,
  Wallet, Zap, type LucideIcon,
} from 'lucide-react';
import type {
  BulletsParams, CardsParams, ChatParams, CompareParams, CtaParams, IconName, MotionScene, MotionTheme, OrbitParams, ProcessParams,
  StatementParams, StatParams, TitleParams,
} from './types';

const ICON_MAP: Record<IconName, LucideIcon> = {
  sparkles: Sparkles, brain: Brain, cpu: Cpu, bot: Bot, message: MessageSquare, image: Image, video: Video, music: Music, file: FileText,
  lightbulb: Lightbulb, rocket: Rocket, trending: TrendingUp, chart: BarChart3, pie: PieChart, money: DollarSign, coins: Coins, wallet: Wallet,
  cart: ShoppingCart, users: Users, user: User, heart: Heart, star: Star, clock: Clock, calendar: Calendar, globe: Globe, pin: MapPin, home: Home,
  building: Building2, briefcase: Briefcase, school: GraduationCap, book: BookOpen, code: Code, phone: Smartphone, laptop: Laptop, camera: Camera,
  zap: Zap, shield: Shield, lock: Lock, check: CheckCircle2, target: Target, leaf: Leaf, sun: Sun, coffee: Coffee, fitness: Dumbbell,
  food: Utensils, plane: Plane, car: Car, gift: Gift,
};

/** Shared sizing: everything scales with the short side, so all aspect ratios look right. */
function useLayout() {
  const { width, height } = useVideoConfig();
  const unit = Math.min(width, height) / 100;
  return { width, height, unit, portrait: height > width * 1.15 };
}

/** Entrance (spring in, `delay` frames late) and exit (fade the last 8 frames of the scene). */
function useEnter(delay = 0) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 120, mass: 0.7 } });
  const exit = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return { t, opacity: Math.min(t, exit), y: (1 - t) * 40 };
}

function Icon({ name, size, color }: { name: IconName; size: number; color: string }) {
  const C = ICON_MAP[name] ?? Sparkles;
  return <C size={size} color={color} strokeWidth={1.8} />;
}

const Center: React.FC<{ children: React.ReactNode; gap?: number }> = ({ children, gap = 3 }) => {
  const { unit } = useLayout();
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: `${unit * 8}px`, gap: unit * gap, flexDirection: 'column', textAlign: 'center' }}>
      {children}
    </AbsoluteFill>
  );
};

function Title({ p, theme }: { p: TitleParams; theme: MotionTheme }) {
  const { unit } = useLayout();
  const a = useEnter(0);
  const b = useEnter(6);
  return (
    <Center gap={2.5}>
      {p.eyebrow && (
        <div style={{ opacity: a.opacity, transform: `translateY(${a.y}px)`, color: theme.secondary, fontSize: unit * 4.2, fontWeight: 700, letterSpacing: unit * 0.6, textTransform: 'uppercase' }}>{p.eyebrow}</div>
      )}
      <div style={{ opacity: b.opacity, transform: `translateY(${b.y}px) scale(${0.92 + 0.08 * b.t})`, color: theme.text, fontSize: unit * 10, fontWeight: 800, lineHeight: 1.22 }}>{p.headline}</div>
      <div style={{ width: unit * 22 * b.t, height: unit * 0.9, borderRadius: unit, background: `linear-gradient(90deg, ${theme.primary}, ${theme.secondary})`, opacity: b.opacity }} />
    </Center>
  );
}

function Statement({ p, theme }: { p: StatementParams; theme: MotionTheme }) {
  const { unit } = useLayout();
  const words = p.text.split(/\s+/);
  const hl = p.highlight?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return (
    <Center>
      <div style={{ fontSize: unit * 7.4, fontWeight: 800, lineHeight: 1.3, color: theme.text, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: `${unit * 1}px ${unit * 1.8}px` }}>
        {words.map((w, i) => (
          <Word key={i} delay={i * 3} highlight={Boolean(hl) && w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === hl} theme={theme}>
            {w}
          </Word>
        ))}
      </div>
    </Center>
  );
}

function Word({ children, delay, highlight, theme }: { children: React.ReactNode; delay: number; highlight: boolean; theme: MotionTheme }) {
  const e = useEnter(delay);
  const { unit } = useLayout();
  return (
    <span
      style={{
        opacity: e.opacity,
        transform: `translateY(${e.y * 0.6}px)`,
        display: 'inline-block',
        color: highlight ? theme.background : theme.text,
        background: highlight ? `linear-gradient(90deg, ${theme.primary}, ${theme.secondary})` : 'transparent',
        padding: highlight ? `0 ${unit * 1.2}px` : 0,
        borderRadius: unit * 1.2,
      }}
    >
      {children}
    </span>
  );
}

function Stat({ p, theme }: { p: StatParams; theme: MotionTheme }) {
  const { unit } = useLayout();
  const frame = useCurrentFrame();
  const e = useEnter(0);
  const l = useEnter(10);
  // Count up the numeric part ("73%" → 0…73%, "₹2.5L" → 0…2.5).
  const m = p.value.match(/^(\D*)(\d+(?:[.,]\d+)?)(.*)$/);
  let shown = p.value;
  if (m) {
    const target = Number(m[2]!.replace(',', '.'));
    const decimals = (m[2]!.split(/[.,]/)[1] ?? '').length;
    const v = interpolate(frame, [0, 28], [0, target], { extrapolateRight: 'clamp' });
    shown = `${m[1]}${v.toFixed(decimals)}${m[3]}`;
  }
  return (
    <Center gap={2}>
      <div style={{ opacity: e.opacity, transform: `scale(${0.8 + 0.2 * e.t})`, fontSize: unit * 22, fontWeight: 900, lineHeight: 1, backgroundImage: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`, WebkitBackgroundClip: 'text', color: 'transparent', fontVariantNumeric: 'tabular-nums' }}>{shown}</div>
      <div style={{ opacity: l.opacity, transform: `translateY(${l.y}px)`, color: theme.text, fontSize: unit * 5.4, fontWeight: 600, maxWidth: unit * 80 }}>{p.label}</div>
    </Center>
  );
}

function Bullets({ p, theme }: { p: BulletsParams; theme: MotionTheme }) {
  const { unit } = useLayout();
  const h = useEnter(0);
  return (
    <Center gap={3}>
      {p.title && <div style={{ opacity: h.opacity, transform: `translateY(${h.y}px)`, color: theme.text, fontSize: unit * 6.8, fontWeight: 800 }}>{p.title}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: unit * 2.2, width: '100%', maxWidth: unit * 86 }}>
        {p.items.map((item, i) => (
          <Pill key={i} delay={6 + i * 8} theme={theme} index={i}>
            {item}
          </Pill>
        ))}
      </div>
    </Center>
  );
}

function Pill({ children, delay, theme, index }: { children: React.ReactNode; delay: number; theme: MotionTheme; index: number }) {
  const e = useEnter(delay);
  const { unit } = useLayout();
  return (
    <div style={{ opacity: e.opacity, transform: `translateX(${(1 - e.t) * -60}px)`, display: 'flex', alignItems: 'center', gap: unit * 2.4, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: unit * 2.4, padding: `${unit * 2.4}px ${unit * 3}px`, textAlign: 'left' }}>
      <div style={{ width: unit * 6, height: unit * 6, borderRadius: unit * 6, flexShrink: 0, display: 'grid', placeItems: 'center', background: index % 2 ? theme.secondary : theme.primary, color: theme.background, fontWeight: 800, fontSize: unit * 3.2 }}>{index + 1}</div>
      <div style={{ color: theme.text, fontSize: unit * 4.6, fontWeight: 600 }}>{children}</div>
    </div>
  );
}

function Cards({ p, theme }: { p: CardsParams; theme: MotionTheme }) {
  const { unit, portrait } = useLayout();
  const h = useEnter(0);
  const cols = portrait ? (p.cards.length > 2 ? 2 : 1) : p.cards.length;
  return (
    <Center gap={3.5}>
      {p.title && <div style={{ opacity: h.opacity, transform: `translateY(${h.y}px)`, color: theme.text, fontSize: unit * 6.8, fontWeight: 800 }}>{p.title}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: unit * 2.6, width: '100%', maxWidth: unit * (portrait ? 86 : 140) }}>
        {p.cards.map((c, i) => (
          <CardItem key={i} delay={6 + i * 6} theme={theme} icon={c.icon} label={c.label} />
        ))}
      </div>
    </Center>
  );
}

function CardItem({ delay, theme, icon, label }: { delay: number; theme: MotionTheme; icon: IconName; label: string }) {
  const e = useEnter(delay);
  const { unit } = useLayout();
  return (
    <div style={{ opacity: e.opacity, transform: `translateY(${e.y}px) scale(${0.9 + 0.1 * e.t})`, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: unit * 3, padding: unit * 3.4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: unit * 1.8 }}>
      <div style={{ width: unit * 13, height: unit * 13, borderRadius: unit * 3.4, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})` }}>
        <Icon name={icon} size={unit * 7} color={theme.background} />
      </div>
      <div style={{ color: theme.text, fontSize: unit * 4.4, fontWeight: 700 }}>{label}</div>
    </div>
  );
}

function Process({ p, theme }: { p: ProcessParams; theme: MotionTheme }) {
  const { unit, portrait } = useLayout();
  return (
    <Center>
      <div style={{ display: 'flex', flexDirection: portrait ? 'column' : 'row', alignItems: 'center', gap: unit * 2 }}>
        {p.steps.map((s, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Arrow delay={i * 12 - 4} theme={theme} vertical={portrait} />}
            <Step delay={i * 12} theme={theme} icon={s.icon} label={s.label} />
          </React.Fragment>
        ))}
      </div>
    </Center>
  );
}

function Step({ delay, theme, icon, label }: { delay: number; theme: MotionTheme; icon: IconName; label: string }) {
  const e = useEnter(delay);
  const { unit } = useLayout();
  return (
    <div style={{ opacity: e.opacity, transform: `scale(${0.85 + 0.15 * e.t})`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: unit * 1.4 }}>
      <div style={{ width: unit * 15, height: unit * 15, borderRadius: unit * 15, display: 'grid', placeItems: 'center', border: `${unit * 0.6}px solid ${theme.primary}`, background: 'rgba(255,255,255,0.06)' }}>
        <Icon name={icon} size={unit * 7} color={theme.text} />
      </div>
      <div style={{ color: theme.text, fontSize: unit * 4.2, fontWeight: 700, maxWidth: unit * 34 }}>{label}</div>
    </div>
  );
}

function Arrow({ delay, theme, vertical }: { delay: number; theme: MotionTheme; vertical: boolean }) {
  const e = useEnter(delay);
  const { unit } = useLayout();
  return (
    <div style={{ opacity: e.opacity, transform: `${vertical ? 'rotate(90deg) ' : ''}translateX(${(1 - e.t) * -20}px)` }}>
      <ArrowRight size={unit * 7} color={theme.secondary} strokeWidth={2.4} />
    </div>
  );
}

function Compare({ p, theme }: { p: CompareParams; theme: MotionTheme }) {
  const { unit, portrait } = useLayout();
  return (
    <Center>
      <div style={{ display: 'flex', flexDirection: portrait ? 'column' : 'row', gap: unit * 3, width: '100%', maxWidth: unit * (portrait ? 86 : 150) }}>
        <Side title={p.leftTitle} points={p.leftPoints} color={theme.secondary} delay={0} theme={theme} />
        <Side title={p.rightTitle} points={p.rightPoints} color={theme.primary} delay={10} theme={theme} />
      </div>
    </Center>
  );
}

function Side({ title, points, color, delay, theme }: { title: string; points: string[]; color: string; delay: number; theme: MotionTheme }) {
  const e = useEnter(delay);
  const { unit } = useLayout();
  return (
    <div style={{ flex: 1, opacity: e.opacity, transform: `translateY(${e.y}px)`, borderRadius: unit * 3, padding: unit * 3.4, background: 'rgba(255,255,255,0.06)', borderTop: `${unit * 0.8}px solid ${color}`, textAlign: 'left' }}>
      <div style={{ color, fontSize: unit * 5.4, fontWeight: 800, marginBottom: unit * 1.6 }}>{title}</div>
      {points.map((pt, i) => (
        <div key={i} style={{ color: theme.text, fontSize: unit * 4.2, fontWeight: 500, marginTop: unit * 1 }}>
          • {pt}
        </div>
      ))}
    </div>
  );
}

function Chat({ p, theme }: { p: ChatParams; theme: MotionTheme }) {
  const { unit } = useLayout();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const typeEnd = Math.min(durationInFrames * 0.4, 6 + p.prompt.length * 1.2);
  const typed = p.prompt.slice(0, Math.round(interpolate(frame, [4, typeEnd], [0, p.prompt.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })));
  const box = useEnter(0);
  const reply = useEnter(Math.round(typeEnd + 6));
  const cursor = frame % 16 < 8 && typed.length < p.prompt.length;
  return (
    <Center>
      <div style={{ opacity: box.opacity, width: '100%', maxWidth: unit * 88, borderRadius: unit * 3, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', padding: unit * 3, display: 'flex', flexDirection: 'column', gap: unit * 2.4, textAlign: 'left' }}>
        <div style={{ alignSelf: 'flex-end', maxWidth: '85%', background: theme.primary, color: theme.background, borderRadius: `${unit * 3}px ${unit * 3}px ${unit * 0.8}px ${unit * 3}px`, padding: `${unit * 2}px ${unit * 2.6}px`, fontSize: unit * 4.2, fontWeight: 600, minHeight: unit * 6 }}>
          {typed}
          {cursor && '▍'}
        </div>
        <div style={{ opacity: reply.opacity, transform: `translateY(${reply.y * 0.5}px)`, alignSelf: 'flex-start', maxWidth: '90%', display: 'flex', gap: unit * 1.6, alignItems: 'flex-start' }}>
          <div style={{ width: unit * 7, height: unit * 7, borderRadius: unit * 7, flexShrink: 0, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})` }}>
            <Sparkles size={unit * 3.8} color={theme.background} />
          </div>
          <div style={{ background: 'rgba(255,255,255,0.1)', color: theme.text, borderRadius: `${unit * 3}px ${unit * 3}px ${unit * 3}px ${unit * 0.8}px`, padding: `${unit * 2}px ${unit * 2.6}px`, fontSize: unit * 4.2 }}>{p.reply}</div>
        </div>
      </div>
    </Center>
  );
}

function Orbit({ p, theme }: { p: OrbitParams; theme: MotionTheme }) {
  const { unit } = useLayout();
  const frame = useCurrentFrame();
  const center = useEnter(0);
  const r = unit * 30;
  return (
    <Center gap={5}>
      <div style={{ position: 'relative', width: r * 2 + unit * 14, height: r * 2 + unit * 14 }}>
        <div style={{ position: 'absolute', inset: unit * 7, borderRadius: '50%', border: `2px dashed rgba(255,255,255,0.18)` }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%, -50%) scale(${center.t})`, width: unit * 22, height: unit * 22, borderRadius: unit * 6, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`, boxShadow: `0 0 ${unit * 10}px ${theme.primary}66` }}>
          <Icon name={p.centerIcon} size={unit * 11} color={theme.background} />
        </div>
        {p.icons.map((ic, i) => {
          const angle = (i / p.icons.length) * Math.PI * 2 + frame / 90;
          const appear = spring({ frame: frame - 8 - i * 4, fps: 30, config: { damping: 16 } });
          return (
            <div key={i} style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(calc(-50% + ${Math.cos(angle) * r * appear}px), calc(-50% + ${Math.sin(angle) * r * appear}px))`, opacity: appear, width: unit * 12, height: unit * 12, borderRadius: unit * 12, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.18)' }}>
              <Icon name={ic} size={unit * 6} color={theme.text} />
            </div>
          );
        })}
      </div>
      <div style={{ opacity: center.opacity, color: theme.text, fontSize: unit * 6, fontWeight: 800 }}>{p.label}</div>
    </Center>
  );
}

function Cta({ p, theme }: { p: CtaParams; theme: MotionTheme }) {
  const { unit } = useLayout();
  const frame = useCurrentFrame();
  const h = useEnter(0);
  const b = useEnter(10);
  const pulse = 1 + Math.sin(frame / 6) * 0.03;
  return (
    <Center gap={4}>
      <div style={{ opacity: h.opacity, transform: `translateY(${h.y}px)`, color: theme.text, fontSize: unit * 8.4, fontWeight: 800, lineHeight: 1.25 }}>{p.headline}</div>
      <div style={{ opacity: b.opacity, transform: `scale(${(0.8 + 0.2 * b.t) * pulse})`, background: `linear-gradient(90deg, ${theme.primary}, ${theme.secondary})`, color: theme.background, fontWeight: 800, fontSize: unit * 5, padding: `${unit * 2.6}px ${unit * 6}px`, borderRadius: unit * 8, display: 'flex', alignItems: 'center', gap: unit * 2 }}>
        {p.action} <ArrowRight size={unit * 5} color={theme.background} strokeWidth={2.6} />
      </div>
    </Center>
  );
}

/** Renders one scene by template id. Unknown templates render nothing (the server validates first). */
export function SceneView({ scene, theme }: { scene: MotionScene; theme: MotionTheme }) {
  switch (scene.template) {
    case 'title':
      return <Title p={scene.params} theme={theme} />;
    case 'statement':
      return <Statement p={scene.params} theme={theme} />;
    case 'stat':
      return <Stat p={scene.params} theme={theme} />;
    case 'bullets':
      return <Bullets p={scene.params} theme={theme} />;
    case 'cards':
      return <Cards p={scene.params} theme={theme} />;
    case 'process':
      return <Process p={scene.params} theme={theme} />;
    case 'compare':
      return <Compare p={scene.params} theme={theme} />;
    case 'chat':
      return <Chat p={scene.params} theme={theme} />;
    case 'orbit':
      return <Orbit p={scene.params} theme={theme} />;
    case 'cta':
      return <Cta p={scene.params} theme={theme} />;
    default:
      return null;
  }
}
