import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { CAPTION_POSITIONS, CAPTION_SIZES } from './Project.js';

export const LOGO_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export const LOGO_SIZES = ['small', 'medium', 'large'] as const;
export const LOGO_WIDTH: Record<(typeof LOGO_SIZES)[number], number> = { small: 0.12, medium: 0.18, large: 0.25 };
export const CAPTION_STYLE_IDS = ['bold_pop', 'clean_minimal', 'karaoke', 'boxed', 'cinematic'] as const;

const hex = { type: String, match: /^#[0-9a-fA-F]{6}$/ };

/** One brand kit per workspace: applied to new projects and overlaid on renders. */
const brandKitSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    logoAssetId: { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
    logoPosition: { type: String, enum: LOGO_POSITIONS, default: 'top-right' },
    logoSize: { type: String, enum: LOGO_SIZES, default: 'medium' },
    logoOpacity: { type: Number, min: 0.2, max: 1, default: 0.9 },
    primaryColor: { ...hex, default: '#7C3AED' },
    secondaryColor: { ...hex, default: '#06B6D4' },
    captionStyle: { type: String, enum: CAPTION_STYLE_IDS, default: 'bold_pop' },
    captionPosition: { type: String, enum: CAPTION_POSITIONS, default: 'bottom' },
    captionSize: { type: String, enum: CAPTION_SIZES, default: 'medium' },
    highlightColor: { ...hex, default: '#A78BFA' },
    applyToNewProjects: { type: Boolean, default: true },
  },
  { timestamps: true },
);

brandKitSchema.index({ workspaceId: 1 }, { unique: true });

export type BrandKitDoc = HydratedDocument<InferSchemaType<typeof brandKitSchema>>;
export const BrandKit = model('BrandKit', brandKitSchema);
