import mongoose from 'mongoose';
import { config } from './env.js';
import { Template } from '../models/Template.js';

const SYSTEM_TEMPLATES = [
  {
    title: 'Neon Viral Hook',
    category: 'Viral',
    description: 'High-energy layout with bright yellow neon karaoke captions, dynamic zoom cuts, and fast-paced sound effects.',
    aspectRatio: '9:16',
    captionStyle: 'karaoke_neon',
    highlightColor: '#FACC15',
    fontFamily: 'Cabinet Grotesk',
    zoomIntensity: 'dynamic',
    brollIntensity: 'high',
    suggestedMusicCategory: 'energetic_trap',
    isPremium: false,
    isSystem: true,
    tags: ['viral', 'submagic', 'fast-paced', 'instagram'],
  },
  {
    title: 'Deep Podcast Dialogue',
    category: 'Podcast',
    description: 'Subtle clean captions with active speaker detection, soft cinematic grain, and gentle ambient background ducking.',
    aspectRatio: '9:16',
    captionStyle: 'clean_minimal',
    highlightColor: '#38BDF8',
    fontFamily: 'Plus Jakarta Sans',
    zoomIntensity: 'subtle',
    brollIntensity: 'low',
    suggestedMusicCategory: 'lofi_ambient',
    isPremium: false,
    isSystem: true,
    tags: ['podcast', 'interview', 'subtle', 'storytelling'],
  },
  {
    title: 'Business & Finance Explainer',
    category: 'Business',
    description: 'Authoritative typography with key financial metric pop-ups, animated charts, and crisp stock overlays.',
    aspectRatio: '9:16',
    captionStyle: 'corporate_bold',
    highlightColor: '#10B981',
    fontFamily: 'Plus Jakarta Sans',
    zoomIntensity: 'subtle',
    brollIntensity: 'medium',
    suggestedMusicCategory: 'corporate_tech',
    isPremium: true,
    isSystem: true,
    tags: ['finance', 'crypto', 'investing', 'explainer'],
  },
  {
    title: 'Motivational Stoic Reels',
    category: 'Motivational',
    description: 'Dramatic black & white visual grading, bold center-weighted uppercase captions, and deep orchestral hits.',
    aspectRatio: '9:16',
    captionStyle: 'cinematic_headline',
    highlightColor: '#E2E8F0',
    fontFamily: 'Cabinet Grotesk',
    zoomIntensity: 'dynamic',
    brollIntensity: 'high',
    suggestedMusicCategory: 'epic_orchestral',
    isPremium: false,
    isSystem: true,
    tags: ['stoic', 'gym', 'mindset', 'motivation'],
  },
  {
    title: 'Tech & AI News Rundown',
    category: 'Educational',
    description: 'Futuristic glassmorphism caption badges, automated keyword highlighting, and split-screen product showcases.',
    aspectRatio: '16:9',
    captionStyle: 'tech_hud',
    highlightColor: '#A855F7',
    fontFamily: 'Plus Jakarta Sans',
    zoomIntensity: 'subtle',
    brollIntensity: 'medium',
    suggestedMusicCategory: 'synthwave',
    isPremium: false,
    isSystem: true,
    tags: ['tech', 'ai', 'youtube', 'widescreen'],
  },
];

export const seedInitialTemplates = async () => {
  try {
    const count = await Template.countDocuments();
    if (count === 0) {
      await Template.insertMany(SYSTEM_TEMPLATES);
      console.log('✅ Seeded default system video templates.');
    }
  } catch (err) {
    console.warn('⚠️ Template seeding skipped or deferred:', (err as Error).message);
  }
};

export const connectDB = async (): Promise<boolean> => {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`🚀 MongoDB Connected successfully: ${mongoose.connection.host}`);
    await seedInitialTemplates();
    return true;
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', (err as Error).message);
    return false;
  }
};

export const disconnectDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};

