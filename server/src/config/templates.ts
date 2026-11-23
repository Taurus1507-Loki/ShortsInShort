import type { MotionScene } from '../services/faceless/motion.js';

/**
 * Ready-made video templates: a starting point for a new project (mode, editing style, frame,
 * settings, a topic and a script outline the user edits). Every template is validated against the
 * project schema and the Motion scene schemas in tests, so "Use template" always creates a valid project.
 */
export const TEMPLATE_CATEGORIES = ['marketing', 'education', 'social', 'business', 'lifestyle'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** Who a template is made for (the gallery's "Made for" filter). */
export const TEMPLATE_NICHES = ['creators', 'tech', 'doctors', 'coaches', 'finance', 'real_estate', 'business', 'educators', 'food', 'storytellers'] as const;
export type TemplateNiche = (typeof TEMPLATE_NICHES)[number];

export interface VideoTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  mode: 'editor' | 'avatar' | 'faceless';
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
  style: 'viral' | 'podcast' | 'cinematic' | 'educational' | 'business' | 'storytelling' | 'vlog' | 'product_promotion';
  /** Partial project settings applied over the defaults. */
  settings: Record<string, unknown>;
  /** Suggested title and topic (faceless) for the wizard. */
  title: string;
  topic: string;
  /** Script outline for voiced modes; tips for the editor. The user rewrites it. */
  script: string;
  /** What the template is good for, shown on the card. */
  bestFor: string;
  /** Who it's made for (filter chips). */
  niches: TemplateNiche[];
  /** Stock search used for the preview storyboard (stock and editor templates). */
  previewQuery?: string;
  /** Sample animated scenes previewed live (Motion Explainer templates). */
  motionScenes?: MotionScene[];
}

export const VIDEO_TEMPLATES: VideoTemplate[] = [
  {
    id: 'product-promo',
    name: 'Product promo',
    category: 'marketing',
    description: 'A fast 30-second ad: problem, product, three benefits, offer. Stock footage cut to your voiceover.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'product_promotion',
    settings: { facelessStyle: 'stock', sceneTransition: 'mix', captionStyle: 'bold_pop', captionPosition: 'middle', soundEffects: true, targetDurationSec: 30 },
    title: 'Product promo',
    topic: 'Why our product makes everyday life easier',
    script:
      'Tired of wasting time on the same boring task every day? Meet [product]. It does the hard part for you in seconds. It is simple to use, it works anywhere, and it pays for itself in a week. Thousands of people already switched. Order today and get 20% off your first month.',
    bestFor: 'D2C brands, shops, launches',
    niches: ['business'],
    previewQuery: 'online shopping',
  },
  {
    id: 'tool-explainer',
    name: 'AI tool explainer',
    category: 'education',
    description: 'Animated scenes explain how a tool or idea works, step by step, with icons and a closing call to action.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'educational',
    settings: { facelessStyle: 'motion', motionTheme: 'lavender', soundEffects: true, captionStyle: 'clean_minimal', captionPosition: 'bottom' },
    title: 'How it works',
    topic: 'How an AI writing assistant works',
    script:
      'Ever wondered how AI writing tools work? You type a simple request. The AI reads it, plans an answer, and writes it in seconds. It can draft emails, captions and blog posts. You stay in control and edit the final words. Try one today and save hours every week.',
    bestFor: 'SaaS, edtech, creators explaining ideas',
    niches: ['tech', 'educators'],
    motionScenes: [
      { template: 'title', params: { eyebrow: 'Explained', headline: 'How AI writing tools work' } },
      { template: 'process', params: { steps: [{ icon: 'message', label: 'You ask' }, { icon: 'brain', label: 'AI plans' }, { icon: 'file', label: 'It writes' }] } },
      { template: 'cta', params: { headline: 'Save hours every week', action: 'Try it free' } },
    ],
  },
  {
    id: 'top-5-tips',
    name: 'Top 5 tips',
    category: 'social',
    description: 'A numbered listicle that keeps viewers watching to the end. Punchy captions and quick cuts.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'viral',
    settings: { facelessStyle: 'stock', sceneTransition: 'cut', captionStyle: 'bold_pop', captionSize: 'large', soundEffects: true },
    title: '5 tips',
    topic: '5 simple habits to be more productive',
    script:
      'Five habits that will make you more productive. One: plan tomorrow tonight. Two: do the hardest task first. Three: keep your phone in another room. Four: take a short walk every two hours. Five: stop work at the same time every day. Save this and try one tomorrow.',
    bestFor: 'Reels, Shorts, any niche',
    niches: ['creators', 'coaches'],
    previewQuery: 'desk planning notebook',
  },
  {
    id: 'news-recap',
    name: 'Daily news recap',
    category: 'business',
    description: 'Animated headline, big numbers and key points, ideal for market, tech or local news updates.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'business',
    settings: { facelessStyle: 'motion', motionTheme: 'sky', soundEffects: true, captionStyle: 'boxed' },
    title: 'Today in 60 seconds',
    topic: "Today's top business headlines",
    script:
      "Here are today's top business headlines in 60 seconds. Markets closed higher, led by technology stocks. Online sales grew 18 percent this quarter. A new startup fund opened for small businesses. And fuel prices stay unchanged this week. Follow for tomorrow's recap.",
    bestFor: 'News pages, finance creators',
    niches: ['creators', 'tech'],
    motionScenes: [
      { template: 'title', params: { eyebrow: 'Today in 60 seconds', headline: 'Top business headlines' } },
      { template: 'stat', params: { value: '18%', label: 'growth in online sales this quarter' } },
      { template: 'bullets', params: { title: 'Also today', items: ['Markets closed higher', 'New fund for small businesses', 'Fuel prices unchanged'] } },
    ],
  },
  {
    id: 'podcast-clip',
    name: 'Podcast clip',
    category: 'social',
    description: 'Turn a podcast or interview into a vertical clip: gentle cuts, clean captions, a few cutaways.',
    mode: 'editor',
    aspectRatio: '9:16',
    style: 'podcast',
    settings: { editingIntensity: 'low', bRollIntensity: 'low', zoomIntensity: 'subtle', captionStyle: 'clean_minimal', captionPosition: 'bottom', framing: 'auto' },
    title: 'Podcast clip',
    topic: '',
    script: 'Tip: upload a 1–3 minute segment with one clear idea. The best clips start with a strong opening line.',
    bestFor: 'Podcasters, interviews, webinars',
    niches: ['creators', 'coaches'],
    previewQuery: 'podcast microphone studio',
  },
  {
    id: 'viral-talking-head',
    name: 'Viral talking head',
    category: 'social',
    description: 'A punchy edit of you talking to camera: tight cuts, zoom punch-ins, bold captions and lots of B-roll.',
    mode: 'editor',
    aspectRatio: '9:16',
    style: 'viral',
    settings: { editingIntensity: 'high', bRollIntensity: 'high', zoomIntensity: 'dynamic', captionStyle: 'bold_pop', captionSize: 'large', captionPosition: 'middle' },
    title: 'Talking head reel',
    topic: '',
    script: 'Tip: record yourself in good light, 30–90 seconds, and get to the point in the first sentence. B-roll covers about 70% of the video.',
    bestFor: 'Creators, coaches, personal brands',
    niches: ['creators', 'coaches'],
    previewQuery: 'woman talking camera',
  },
  {
    id: 'tutorial',
    name: 'How-to tutorial',
    category: 'education',
    description: 'A clear, calm edit of a screen or camera tutorial with boxed captions and helpful cutaways.',
    mode: 'editor',
    aspectRatio: '16:9',
    style: 'educational',
    settings: { editingIntensity: 'medium', bRollIntensity: 'medium', zoomIntensity: 'subtle', captionStyle: 'boxed', captionPosition: 'bottom', framing: 'blur' },
    title: 'Tutorial',
    topic: '',
    script: 'Tip: say what viewers will learn in the first 10 seconds, then show each step. Pauses are tightened automatically.',
    bestFor: 'Teachers, YouTube how-tos, courses',
    niches: ['educators', 'tech'],
    previewQuery: 'laptop tutorial learning',
  },
  {
    id: 'property-tour',
    name: 'Property showcase',
    category: 'business',
    description: 'Cinematic stock visuals and a warm voiceover that sells a home, venue or location.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'cinematic',
    settings: { facelessStyle: 'stock', sceneTransition: 'fade', captionStyle: 'cinematic', soundEffects: false },
    title: 'Property showcase',
    topic: 'A modern 3-bedroom apartment with a city view',
    script:
      'Welcome home. Bright, open living spaces filled with natural light. A modern kitchen made for family dinners. Three peaceful bedrooms and a balcony with a view of the city. Schools, shops and the metro are minutes away. Book your visit this weekend.',
    bestFor: 'Real estate, hotels, venues',
    niches: ['real_estate'],
    previewQuery: 'modern apartment interior',
  },
  {
    id: 'motivation',
    name: 'Motivational quote',
    category: 'lifestyle',
    description: 'Slow, cinematic stock shots with soft fades under an inspiring message.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'storytelling',
    settings: { facelessStyle: 'stock', sceneTransition: 'fade', captionStyle: 'cinematic', captionSize: 'large', soundEffects: false },
    title: 'Daily motivation',
    topic: 'Small steps every day lead to big results',
    script:
      'Nobody sees the early mornings. Nobody sees the practice. They only see the result. Every small step you take today is building the person you will be tomorrow. Keep going. Your future self is watching.',
    bestFor: 'Motivation pages, coaches',
    niches: ['coaches', 'storytellers'],
    previewQuery: 'sunrise mountain',
  },
  {
    id: 'startup-pitch',
    name: 'Startup pitch',
    category: 'business',
    description: 'A widescreen animated pitch: the problem, your solution, traction numbers and the ask.',
    mode: 'faceless',
    aspectRatio: '16:9',
    style: 'business',
    settings: { facelessStyle: 'motion', motionTheme: 'paper', soundEffects: true, captionStyle: 'clean_minimal' },
    title: 'Pitch video',
    topic: 'Our startup in one minute',
    script:
      'Small shops lose hours every week managing orders by hand. We built a simple app that does it automatically. Shops save six hours a week on average. Today 2,000 shops use it across India, growing 30 percent every month. We are raising our seed round. Let us talk.',
    bestFor: 'Founders, demo days, investor updates',
    niches: ['business', 'tech'],
    motionScenes: [
      { template: 'compare', params: { leftTitle: 'Before', leftPoints: ['Orders by hand', 'Hours lost'], rightTitle: 'With us', rightPoints: ['Automatic', '6 h saved / week'] } },
      { template: 'stat', params: { value: '2,000', label: 'shops across India' } },
      { template: 'cta', params: { headline: 'Raising our seed round', action: "Let's talk" } },
    ],
  },
  {
    id: 'announcement',
    name: 'Team announcement',
    category: 'business',
    description: 'An AI voiceover video for updates, launches or internal news, on your brand background.',
    mode: 'avatar',
    aspectRatio: '9:16',
    style: 'business',
    settings: { background: 'brand', captionStyle: 'clean_minimal', disclosure: true },
    title: 'Announcement',
    topic: '',
    script:
      'Big news! Starting next week, our new feature is live for every customer. It makes your daily work faster and simpler. You will find it in your dashboard, with a short guide to get started. Thank you for building with us.',
    bestFor: 'Product updates, HR, internal comms',
    niches: ['business'],
    previewQuery: 'office team meeting',
  },
  {
    id: 'recipe',
    name: 'Recipe in 60 seconds',
    category: 'lifestyle',
    description: 'Quick, appetising food shots with step-by-step narration and bold captions.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'vlog',
    settings: { facelessStyle: 'stock', sceneTransition: 'mix', captionStyle: 'bold_pop', soundEffects: true },
    title: 'Recipe',
    topic: 'Easy masala chai at home',
    script:
      'Perfect masala chai in five minutes. Boil one cup of water with crushed ginger and cardamom. Add one spoon of tea leaves and let it simmer. Pour in a cup of milk and sugar to taste. Bring it to a boil, strain, and enjoy. Save this recipe for your next tea break.',
    bestFor: 'Food creators, restaurants, cloud kitchens',
    niches: ['food'],
    previewQuery: 'tea cooking kitchen',
  },
  {
    id: 'hindi-explainer',
    name: 'Hindi explainer',
    category: 'education',
    description: 'An animated explainer narrated in Hindi with Devanagari captions. Change the language to Telugu, Tamil or Marathi.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'educational',
    settings: { facelessStyle: 'motion', motionTheme: 'peach', language: 'hi', soundEffects: true, captionStyle: 'boxed' },
    title: 'Hindi explainer',
    topic: 'UPI se payment kaise karein',
    script:
      'UPI से पेमेंट करना बहुत आसान है। अपना UPI ऐप खोलें। QR कोड स्कैन करें या नंबर डालें। रकम लिखें और अपना पिन डालें। बस, पेमेंट हो गया। ऐसी और जानकारी के लिए फॉलो करें।',
    bestFor: 'Regional creators, fintech, government info',
    niches: ['educators', 'finance'],
    motionScenes: [
      { template: 'title', params: { eyebrow: 'आसान तरीका', headline: 'UPI से पेमेंट कैसे करें' } },
      { template: 'process', params: { steps: [{ icon: 'phone', label: 'ऐप खोलें' }, { icon: 'camera', label: 'QR स्कैन करें' }, { icon: 'check', label: 'पिन डालें' }] } },
      { template: 'cta', params: { headline: 'और जानकारी के लिए', action: 'फॉलो करें' } },
    ],
  },
  {
    id: 'tech-ai-update',
    name: 'Tech & AI update',
    category: 'education',
    description: 'A fast animated update on a new AI tool or gadget: what it is, three things it does, and why it matters. No camera needed.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'educational',
    settings: { facelessStyle: 'motion', motionTheme: 'midnight', soundEffects: true, captionStyle: 'bold_pop', captionPosition: 'bottom' },
    title: 'New AI tool',
    topic: 'A new AI tool that edits videos for you',
    script:
      'This new AI tool just changed video editing. You upload a raw clip. It cuts the pauses, adds captions and picks music in under a minute. It works in Hindi, Telugu and English. Creators are saving hours every week. Follow for one new AI tool every day.',
    bestFor: 'Tech and AI creators, gadget reviewers',
    niches: ['tech', 'creators'],
    motionScenes: [
      { template: 'title', params: { eyebrow: 'New AI tool', headline: 'Video editing just changed' } },
      { template: 'cards', params: { cards: [{ icon: 'video', label: 'Cuts pauses' }, { icon: 'message', label: 'Adds captions' }, { icon: 'music', label: 'Picks music' }] } },
      { template: 'stat', params: { value: '10 hrs', label: 'saved every week' } },
      { template: 'cta', params: { headline: 'One AI tool a day', action: 'Follow' } },
    ],
  },
  {
    id: 'doctor-health-tip',
    name: 'Doctor’s health tip',
    category: 'education',
    description: 'A calm, trustworthy health tip with clear animated steps. Built for doctors and clinics posting daily without filming.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'educational',
    settings: { facelessStyle: 'motion', motionTheme: 'mint', soundEffects: true, captionStyle: 'clean_minimal', captionPosition: 'bottom' },
    title: 'Health tip',
    topic: 'Three habits for better sleep',
    script:
      'Struggling to sleep? Try these three habits tonight. First, keep the same bedtime every day, even on weekends. Second, put your phone away thirty minutes before bed. Third, avoid tea and coffee after four in the evening. Small habits, better sleep. This is general advice, so talk to your doctor about your own health.',
    bestFor: 'Doctors, dentists, physiotherapists, clinics',
    niches: ['doctors'],
    motionScenes: [
      { template: 'title', params: { eyebrow: 'Doctor’s tip', headline: '3 habits for better sleep' } },
      { template: 'bullets', params: { items: ['Same bedtime every day', 'No phone 30 min before bed', 'No caffeine after 4 pm'] } },
      { template: 'cta', params: { headline: 'Save this for tonight', action: 'Follow for more' } },
    ],
  },
  {
    id: 'money-tip',
    name: 'Money tip',
    category: 'education',
    description: 'One clear money tip with a big animated number. Made for CAs, financial advisers and finance creators.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'business',
    settings: { facelessStyle: 'motion', motionTheme: 'forest', soundEffects: true, captionStyle: 'bold_pop', captionPosition: 'bottom' },
    title: 'Money tip',
    topic: 'The 50-30-20 budget rule',
    script:
      'Never know where your salary goes? Try the fifty thirty twenty rule. Fifty percent goes to needs like rent and groceries. Thirty percent goes to wants. Twenty percent goes straight to savings and investments, on the day your salary arrives. Simple, and it works. This is not financial advice, so plan with an expert.',
    bestFor: 'CAs, financial advisers, finance creators',
    niches: ['finance'],
    motionScenes: [
      { template: 'title', params: { eyebrow: 'Money tip', headline: 'The 50-30-20 rule' } },
      { template: 'stat', params: { value: '20%', label: 'to savings, first' } },
      { template: 'compare', params: { leftTitle: 'Needs 50%', leftPoints: ['Rent', 'Groceries'], rightTitle: 'Wants 30%', rightPoints: ['Eating out', 'Shopping'] } },
      { template: 'cta', params: { headline: 'Save more every month', action: 'Follow' } },
    ],
  },
  {
    id: 'fitness-coach',
    name: 'Fitness coach',
    category: 'lifestyle',
    description: 'High-energy workout or diet tip over stock gym footage, punchy captions and quick cuts.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'viral',
    settings: { facelessStyle: 'stock', sceneTransition: 'cut', captionStyle: 'bold_pop', captionSize: 'large', soundEffects: true },
    title: 'Fitness tip',
    topic: 'A 10-minute home workout',
    script:
      'No gym? No problem. Here is a ten minute workout you can do at home. Thirty squats to wake up your legs. Twenty push-ups for your chest and arms. A one minute plank for your core. Rest, then repeat it twice. Do this every morning for a month and feel the difference.',
    bestFor: 'Fitness coaches, gyms, yoga teachers',
    niches: ['coaches'],
    previewQuery: 'home workout',
  },
  {
    id: 'legal-explainer',
    name: 'Know your rights',
    category: 'education',
    description: 'A plain-language legal explainer in clear animated steps. Built for lawyers and legal creators.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'business',
    settings: { facelessStyle: 'motion', motionTheme: 'paper', soundEffects: true, captionStyle: 'boxed', captionPosition: 'bottom' },
    title: 'Know your rights',
    topic: 'What to do if your online order never arrives',
    script:
      'Your online order never arrived? Here is what you can do. First, raise a complaint with the seller and keep the reference number. Second, if there is no reply in fifteen days, file a complaint on the national consumer helpline. Third, keep every bill and screenshot as proof. Know your rights. This is general information, not legal advice.',
    bestFor: 'Lawyers, legal and consumer-rights creators',
    niches: ['business', 'educators'],
    motionScenes: [
      { template: 'title', params: { eyebrow: 'Know your rights', headline: 'Order never arrived?' } },
      { template: 'process', params: { steps: [{ icon: 'message', label: 'Complain to seller' }, { icon: 'phone', label: 'Consumer helpline' }, { icon: 'file', label: 'Keep proof' }] } },
      { template: 'cta', params: { headline: 'Share with a friend', action: 'Follow' } },
    ],
  },
  {
    id: 'storytime',
    name: 'Storytime',
    category: 'social',
    description: 'A short story told over cinematic stock footage with a slow, moody pace and big captions. Keeps people watching to the end.',
    mode: 'faceless',
    aspectRatio: '9:16',
    style: 'storytelling',
    settings: { facelessStyle: 'stock', sceneTransition: 'mix', captionStyle: 'cinematic', captionSize: 'large', soundEffects: true, musicMood: 'cinematic' },
    title: 'Storytime',
    topic: 'The boy who sold tea and built a company',
    script:
      'Fifteen years ago, a boy sold tea outside a railway station. Every evening he watched office workers rush home and wondered what they did all day. He saved two rupees from every cup and bought old books. Today he runs a company with five hundred people. He still drinks tea at that station every year. Never stop learning.',
    bestFor: 'Storytellers, motivation pages, history creators',
    niches: ['storytellers', 'creators'],
    previewQuery: 'railway station evening',
  },
];

export const templateById = (id: string) => VIDEO_TEMPLATES.find((t) => t.id === id) ?? null;
