import { useMemo } from 'react';
import { Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Lottie, type LottieAnimationData } from '@remotion/lottie';
import type { IconName, MotionScene } from './types';

/* ── Animated emoji stickers (Google Noto Animated Emoji, CC BY 4.0 — credited on /legal/credits) ── */
import celebrate from './lottie/emoji/celebrate.json';
import check from './lottie/emoji/check.json';
import eyes from './lottie/emoji/eyes.json';
import fire from './lottie/emoji/fire.json';
import heart from './lottie/emoji/heart.json';
import heartEyes from './lottie/emoji/heart_eyes.json';
import hundred from './lottie/emoji/hundred.json';
import idea from './lottie/emoji/idea.json';
import laughing from './lottie/emoji/laughing.json';
import mindBlown from './lottie/emoji/mind_blown.json';
import party from './lottie/emoji/party.json';
import raisedHands from './lottie/emoji/raised_hands.json';
import rocket from './lottie/emoji/rocket.json';
import star from './lottie/emoji/star.json';
import thumbsUp from './lottie/emoji/thumbs_up.json';

/* ── Animated line icons (useAnimations, MIT) ── */
import uaActivity from 'react-useanimations/lib/activity';
import uaBarChart from 'react-useanimations/lib/barChart';
import uaBook from 'react-useanimations/lib/bookOpen';
import uaBriefcase from 'react-useanimations/lib/briefcase';
import uaCalendar from 'react-useanimations/lib/calendar';
import uaCamera from 'react-useanimations/lib/camera';
import uaCheck from 'react-useanimations/lib/checkCircle';
import uaClock from 'react-useanimations/lib/clock';
import uaCode from 'react-useanimations/lib/code';
import uaCoffee from 'react-useanimations/lib/coffee';
import uaCpu from 'react-useanimations/lib/cpu';
import uaCard from 'react-useanimations/lib/creditCard';
import uaDollar from 'react-useanimations/lib/dollarSign';
import uaFile from 'react-useanimations/lib/fileText';
import uaGift from 'react-useanimations/lib/gift';
import uaGlobe from 'react-useanimations/lib/globe';
import uaHeart from 'react-useanimations/lib/heart';
import uaHome from 'react-useanimations/lib/home';
import uaImage from 'react-useanimations/lib/image';
import uaLock from 'react-useanimations/lib/lock';
import uaMapPin from 'react-useanimations/lib/mapPin';
import uaMessage from 'react-useanimations/lib/messageSquare';
import uaMonitor from 'react-useanimations/lib/monitor';
import uaMusic from 'react-useanimations/lib/music';
import uaPie from 'react-useanimations/lib/pieChart';
import uaShield from 'react-useanimations/lib/shield';
import uaCart from 'react-useanimations/lib/shoppingCart';
import uaPhone from 'react-useanimations/lib/smartphone';
import uaStar from 'react-useanimations/lib/star';
import uaSun from 'react-useanimations/lib/sun';
import uaTarget from 'react-useanimations/lib/target';
import uaTrending from 'react-useanimations/lib/trendingUp';
import uaUser from 'react-useanimations/lib/user';
import uaUsers from 'react-useanimations/lib/users';
import uaVideo from 'react-useanimations/lib/video';
import uaZap from 'react-useanimations/lib/zap';

export const EMOJI = {
  celebrate, check, eyes, fire, heart, heart_eyes: heartEyes, hundred, idea, laughing, mind_blown: mindBlown, party, raised_hands: raisedHands, rocket, star, thumbs_up: thumbsUp,
} as unknown as Record<string, LottieAnimationData>;
export type EmojiName = keyof typeof EMOJI;

type UA = { animationData: LottieAnimationData };
const LINE: Partial<Record<IconName, UA>> = {
  fitness: uaActivity, chart: uaBarChart, book: uaBook, school: uaBook, briefcase: uaBriefcase, calendar: uaCalendar, camera: uaCamera, check: uaCheck,
  clock: uaClock, code: uaCode, coffee: uaCoffee, cpu: uaCpu, wallet: uaCard, money: uaDollar, file: uaFile, gift: uaGift, globe: uaGlobe, heart: uaHeart,
  home: uaHome, image: uaImage, lock: uaLock, pin: uaMapPin, message: uaMessage, laptop: uaMonitor, music: uaMusic, pie: uaPie, shield: uaShield,
  cart: uaCart, phone: uaPhone, star: uaStar, sun: uaSun, target: uaTarget, trending: uaTrending, user: uaUser, users: uaUsers, video: uaVideo, zap: uaZap,
} as unknown as Partial<Record<IconName, UA>>;

export const hasLineIcon = (name: IconName) => Boolean(LINE[name]);

/** Recolours every solid stroke/fill in a Lottie file (the line icons are drawn in black). Cached. */
const recoloured = new Map<string, LottieAnimationData>();
function recolour(name: string, data: LottieAnimationData, color: string): LottieAnimationData {
  const key = `${name}|${color}`;
  const hit = recoloured.get(key);
  if (hit) return hit;
  const rgb = (color.match(/[0-9a-f]{2}/gi) ?? ['ff', 'ff', 'ff']).slice(0, 3).map((v) => parseInt(v, 16) / 255);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const o = { ...(node as Record<string, unknown>) };
    if ((o.ty === 'st' || o.ty === 'fl') && o.c && typeof o.c === 'object' && (o.c as { a?: number }).a === 0) {
      const alpha = ((o.c as { k: number[] }).k[3] ?? 1) as number;
      o.c = { ...(o.c as object), k: [...rgb, alpha] };
    }
    for (const [k, v] of Object.entries(o)) if (k !== 'c' && typeof v === 'object') o[k] = walk(v);
    return o;
  };
  const out = walk(data) as LottieAnimationData;
  recoloured.set(key, out);
  return out;
}

/** A line icon that draws itself once (`delay` frames in), in the given colour. */
export function AnimatedIcon({ name, size, color, delay = 0 }: { name: IconName; size: number; color: string; delay?: number }) {
  const ua = LINE[name];
  const data = useMemo(() => (ua ? recolour(name, ua.animationData, color) : null), [ua, name, color]);
  if (!data) return null;
  return (
    <div style={{ width: size, height: size }}>
      <Sequence from={Math.max(0, Math.round(delay))} layout="none">
        <Lottie animationData={data} loop={false} playbackRate={0.6} renderer="canvas" style={{ width: size, height: size }} />
      </Sequence>
    </div>
  );
}

const TOPICS: Array<[RegExp, EmojiName[]]> = [
  [/money|price|₹|\$|earn|profit|income|save|sales|revenue|rich|cost/i, ['hundred', 'rocket']],
  [/love|favourite|favorite|beautiful|amazing|perfect/i, ['heart_eyes', 'heart']],
  [/funny|fun|joke|lol|laugh|hilarious/i, ['laughing']],
  [/wow|crazy|insane|mind|shock|secret|unbelievable|surpris/i, ['mind_blown', 'eyes']],
  [/idea|tip|hack|trick|learn|smart|why|how/i, ['idea']],
  [/fast|grow|launch|boost|scale|speed|faster|skyrocket/i, ['rocket']],
  [/hot|trend|viral|popular|best|top/i, ['fire']],
  [/done|easy|simple|yes|ready|works|correct|right/i, ['check', 'thumbs_up']],
  [/look|see|watch|notice|check out|attention/i, ['eyes']],
  [/win|success|celebrat|congrat|finally|goal/i, ['party', 'celebrate']],
  [/star|rating|review|quality/i, ['star']],
];
const BY_TEMPLATE: Partial<Record<MotionScene['template'], EmojiName[]>> = {
  stat: ['fire', 'hundred', 'mind_blown'],
  cta: ['raised_hands', 'party', 'thumbs_up', 'celebrate'],
  compare: ['eyes', 'mind_blown'],
  chat: ['idea', 'eyes'],
  process: ['check', 'rocket'],
};

/**
 * Picks an animated emoji for a scene from its words and type, on roughly half the scenes (a sticker
 * on every scene looks cheap). Stable for a given project seed.
 */
export function pickSticker(scene: MotionScene, i: number, seed: number): EmojiName | null {
  const text = JSON.stringify(scene.params);
  const byTopic = TOPICS.find(([re]) => re.test(text))?.[1];
  const options = BY_TEMPLATE[scene.template] ?? byTopic;
  if (!options) return null;
  const always = scene.template === 'stat' || scene.template === 'cta';
  if (!always && (seed + i) % 2 === 1) return null;
  return options[(seed + i) % options.length]!;
}

/** An emoji sticker that pops in near a corner (never at the bottom, where captions go). */
export function Sticker({ name, index }: { name: EmojiName; index: number }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const unit = Math.min(width, height) / 100;
  const size = unit * 19;
  const t = spring({ frame: frame - 8, fps, config: { damping: 9, stiffness: 140, mass: 0.6 } });
  const wobble = Math.sin(frame / 9) * 4;
  const right = index % 2 === 0;
  return (
    <div
      style={{
        position: 'absolute',
        top: height * (height > width ? 0.14 : 0.1),
        [right ? 'right' : 'left']: unit * 7,
        width: size,
        height: size,
        transform: `scale(${t}) rotate(${(right ? 8 : -8) + wobble}deg)`,
        filter: `drop-shadow(0 ${unit * 0.8}px ${unit * 1.4}px rgba(0,0,0,0.25))`,
      }}
    >
      <Sequence from={8} layout="none">
        <Lottie animationData={EMOJI[name]!} loop renderer="canvas" style={{ width: size, height: size }} />
      </Sequence>
    </div>
  );
}
