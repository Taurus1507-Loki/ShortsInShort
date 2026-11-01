import mongoose, { Schema, Document } from 'mongoose';

export interface ITemplate extends Document {
  title: string;
  category: 'Motivational' | 'Educational' | 'Business' | 'Viral' | 'Podcast' | 'Cinematic' | 'Storytelling';
  description: string;
  previewVideoUrl?: string;
  aspectRatio: '9:16' | '16:9';
  captionStyle: string;
  highlightColor: string;
  fontFamily: string;
  zoomIntensity: 'none' | 'subtle' | 'dynamic';
  brollIntensity: 'none' | 'low' | 'medium' | 'high';
  suggestedMusicCategory: string;
  isPremium: boolean;
  isSystem: boolean;
  tags: string[];
}

const TemplateSchema = new Schema<ITemplate>(
  {
    title: { type: String, required: true },
    category: {
      type: String,
      enum: ['Motivational', 'Educational', 'Business', 'Viral', 'Podcast', 'Cinematic', 'Storytelling'],
      required: true,
      index: true,
    },
    description: { type: String, required: true },
    previewVideoUrl: { type: String },
    aspectRatio: { type: String, enum: ['9:16', '16:9'], default: '9:16' },
    captionStyle: { type: String, default: 'karaoke_neon' },
    highlightColor: { type: String, default: '#FACC15' }, // Neon Yellow
    fontFamily: { type: String, default: 'Plus Jakarta Sans' },
    zoomIntensity: { type: String, enum: ['none', 'subtle', 'dynamic'], default: 'dynamic' },
    brollIntensity: { type: String, enum: ['none', 'low', 'medium', 'high'], default: 'high' },
    suggestedMusicCategory: { type: String, default: 'energetic_trap' },
    isPremium: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: true },
    tags: [{ type: String }],
  },
  {
    timestamps: true,
  }
);

export const Template = mongoose.model<ITemplate>('Template', TemplateSchema);

