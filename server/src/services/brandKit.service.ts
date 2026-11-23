import { Types } from 'mongoose';
import { BrandKit } from '../models/BrandKit.js';

/** Returns the workspace's default kit, creating it with defaults on first access. */
export async function getOrCreateKit(workspaceId: Types.ObjectId) {
  return BrandKit.findOneAndUpdate({ workspaceId, isDefault: true }, { $setOnInsert: { workspaceId, isDefault: true, name: 'Main brand' } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

/** The kit a project uses: its chosen kit (same workspace only), else the default. */
export async function kitFor(workspaceId: Types.ObjectId, brandKitId?: string | null) {
  if (brandKitId && Types.ObjectId.isValid(brandKitId)) {
    const kit = await BrandKit.findOne({ _id: brandKitId, workspaceId }).lean();
    if (kit) return kit;
  }
  return BrandKit.findOne({ workspaceId, isDefault: true }).lean();
}

