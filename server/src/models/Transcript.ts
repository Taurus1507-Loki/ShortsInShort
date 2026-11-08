import { Schema, model, type InferSchemaType } from 'mongoose';

const wordSchema = new Schema(
  {
    text: { type: String, required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    confidence: { type: Number, default: null },
    filler: { type: Boolean, default: false },
  },
  { _id: false },
);

/**
 * Word-level transcript of a source video. Cached per (asset, provider, language) so re-rendering
 * a project never pays for transcription twice.
 */
const transcriptSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    assetId: { type: Schema.Types.ObjectId, ref: 'Asset', required: true },
    provider: { type: String, required: true },
    language: { type: String, required: true },
    words: { type: [wordSchema], default: [] },
    durationSec: { type: Number, default: null },
  },
  { timestamps: true },
);

transcriptSchema.index({ assetId: 1, provider: 1, language: 1 }, { unique: true });
transcriptSchema.index({ workspaceId: 1 });

export type TranscriptAttrs = InferSchemaType<typeof transcriptSchema>;
export const Transcript = model('Transcript', transcriptSchema);
