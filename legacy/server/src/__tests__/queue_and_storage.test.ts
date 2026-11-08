import { describe, it, expect } from 'vitest';
import { getStorageService, generateStorageKey } from '../services/storage/storageService.js';
import { addJob, getQueueStats, getJobStatus } from '../services/queue/queueService.js';

describe('ShortsInShort Phase 5 Queue & Storage Test Suite', () => {
  it('generates partitioned storage keys by userId and media category', () => {
    const key = generateStorageKey('user_123', 'processed', 'mp4');
    expect(key).toMatch(/^processed\/user_123\/\d+-[a-f0-9]{8}\.mp4$/);

    const thumbKey = generateStorageKey('user_456', 'thumbnails', 'jpg');
    expect(thumbKey).toMatch(/^thumbnails\/user_456\/\d+-[a-f0-9]{8}\.jpg$/);

    const avatarKey = generateStorageKey('user_789', 'avatars', 'png');
    expect(avatarKey).toMatch(/^avatars\/user_789\/\d+-[a-f0-9]{8}\.png$/);
  });

  it('provides presigned upload URL and public URL resolution', async () => {
    const storage = getStorageService();
    expect(storage).toBeDefined();

    const presigned = await storage.getPresignedUploadUrl('raw/user_123/video.mp4', 'video/mp4');
    expect(presigned.uploadUrl).toBeDefined();
    expect(presigned.key).toBe('raw/user_123/video.mp4');
    expect(presigned.publicUrl).toContain('raw/user_123/video.mp4');
  });

  it('enqueues render and AI jobs and tracks queue statistics', async () => {
    const initialStats = await getQueueStats();
    expect(initialStats).toBeDefined();

    const job = await addJob('video_render', {
      projectId: 'proj_test_999',
      userId: 'user_test_888',
      workspaceId: 'ws_test_777',
      priority: 'high',
    });

    expect(job.id).toBeDefined();
    expect(job.name).toBe('video_render');
    expect(job.data.projectId).toBe('proj_test_999');

    const status = await getJobStatus(job.id);
    expect(status).toBeDefined();
    expect(status?.id).toBe(job.id);
  });
});

