import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { env } from '../../config/env.js';

/** A ready-made presenter the user can pick. Provider-neutral. */
export interface AvatarInfo {
  id: string;
  name: string;
  gender: string | null;
  previewImageUrl: string | null;
  previewVideoUrl: string | null;
  orientation: 'portrait' | 'landscape' | 'square' | null;
  tags: string[];
}

export type AvatarVideoStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AvatarVideoRequest {
  avatarId: string;
  /** Local MP3 of the voiceover; the presenter lip-syncs to it. */
  audioPath: string;
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
  resolution: '720p' | '1080p';
  /** Solid colour behind the presenter (#RRGGBB). */
  backgroundColor: string;
  /** Makes retries of the same job safe: the provider returns the same video. */
  idempotencyKey: string;
  signal?: AbortSignal;
}

/** Provider-independent talking-avatar interface. */
export interface AvatarProvider {
  readonly name: string;
  /** Public (stock) presenters only — custom avatars need a consent flow of their own. */
  listAvatars(signal?: AbortSignal): Promise<AvatarInfo[]>;
  createVideo(req: AvatarVideoRequest): Promise<string>;
  getVideo(videoId: string, signal?: AbortSignal): Promise<{ status: AvatarVideoStatus; videoUrl: string | null; durationSec: number | null; failure: string | null }>;
  download(videoUrl: string, dest: string, signal?: AbortSignal): Promise<void>;
}

export class AvatarError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** True when retrying cannot help (bad key, no credit, unusable avatar, policy). */
    public readonly permanent = false,
  ) {
    super(message);
    this.name = 'AvatarError';
  }
}

interface HeyGenLook {
  id: string;
  name?: string;
  gender?: string | null;
  preview_image_url?: string | null;
  preview_video_url?: string | null;
  preferred_orientation?: 'portrait' | 'landscape' | 'square' | null;
  tags?: string[];
  status?: string;
}

/** Maps a HeyGen v3 look to the neutral shape. Exported for tests. */
export function parseHeyGenLook(l: HeyGenLook): AvatarInfo {
  const https = (u: string | null | undefined) => (u && /^https:\/\//.test(u) ? u : null);
  return {
    id: l.id,
    name: (l.name ?? 'Presenter').slice(0, 80),
    gender: l.gender ?? null,
    previewImageUrl: https(l.preview_image_url),
    previewVideoUrl: https(l.preview_video_url),
    orientation: l.preferred_orientation ?? null,
    tags: Array.isArray(l.tags) ? l.tags.slice(0, 8) : [],
  };
}

/** Turns a HeyGen error body into a user-facing AvatarError. Exported for tests. */
export function heyGenError(status: number, body: string): AvatarError {
  let code = '';
  let message = '';
  try {
    const j = JSON.parse(body) as { error?: { code?: string; message?: string } };
    code = j.error?.code ?? '';
    message = j.error?.message ?? '';
  } catch {
    /* not JSON */
  }
  const permanent = new Set([
    'unauthorized',
    'invalid_parameter',
    'avatar_not_usable',
    'avatar_consent_required',
    'avatar_not_found',
    'content_policy_violation',
    'insufficient_credit',
    'trial_limit_exceeded',
    'subscription_required',
    'endpoint_retired',
    'asset_not_found',
  ]);
  const friendly: Record<string, string> = {
    unauthorized: 'The avatar provider rejected the API key.',
    insufficient_credit: 'The avatar provider account is out of credit.',
    trial_limit_exceeded: 'The avatar provider trial limit is used up.',
    subscription_required: 'The avatar provider account needs a paid plan.',
    avatar_not_found: 'That presenter no longer exists. Choose another one.',
    avatar_not_usable: 'That presenter can’t be used for videos. Choose another one.',
    content_policy_violation: 'The avatar provider refused this script under its content policy.',
    rate_limit_exceeded: 'The avatar provider is busy (rate limited). Retrying shortly.',
    quota_exceeded: 'The avatar provider is busy. Retrying shortly.',
  };
  const text = friendly[code] ?? (message ? `Avatar provider: ${message.slice(0, 200)}` : `Avatar provider request failed (HTTP ${status}).`);
  return new AvatarError(text, status, permanent.has(code) || status === 401 || status === 402 || status === 410);
}

/**
 * HeyGen API v3 (v1/v2 were retired on 2026-10-31).
 * REQUIRES `HEYGEN_API_KEY`. Not exercised against the live API by the test suite.
 */
export class HeyGenProvider implements AvatarProvider {
  readonly name = 'heygen';
  private readonly base = 'https://api.heygen.com';
  constructor(private readonly apiKey: string) {}

  private async call<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}${pathname}`, {
      ...init,
      headers: { 'x-api-key': this.apiKey, Accept: 'application/json', ...(init.headers as Record<string, string>) },
    });
    const text = await res.text();
    if (!res.ok) throw heyGenError(res.status, text);
    return JSON.parse(text) as T;
  }

  async listAvatars(signal?: AbortSignal): Promise<AvatarInfo[]> {
    const out: AvatarInfo[] = [];
    let token: string | null = null;
    for (let page = 0; page < 6; page++) {
      const qs = new URLSearchParams({ ownership: 'public', limit: '50' });
      if (token) qs.set('token', token);
      const body = await this.call<{ data?: HeyGenLook[]; has_more?: boolean; next_token?: string | null }>(`/v3/avatars/looks?${qs}`, { signal });
      for (const l of body.data ?? []) if (l?.id && (!l.status || l.status === 'completed')) out.push(parseHeyGenLook(l));
      if (!body.has_more || !body.next_token) break;
      token = body.next_token;
    }
    return out;
  }

  private async uploadAudio(file: string, signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(await readFile(file))], { type: 'audio/mpeg' }), path.basename(file));
    const body = await this.call<{ data?: { asset_id?: string; id?: string } }>('/v3/assets', { method: 'POST', body: form, signal });
    const id = body.data?.asset_id ?? body.data?.id;
    if (!id) throw new AvatarError('The avatar provider did not accept the voiceover upload.');
    return id;
  }

  async createVideo(req: AvatarVideoRequest): Promise<string> {
    const audioAssetId = await this.uploadAudio(req.audioPath, req.signal);
    const body = await this.call<{ data?: { video_id?: string } }>('/v3/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': req.idempotencyKey },
      body: JSON.stringify({
        type: 'avatar',
        avatar_id: req.avatarId,
        audio_asset_id: audioAssetId,
        aspect_ratio: req.aspectRatio,
        resolution: req.resolution,
        fit: 'cover',
        background: { type: 'color', value: req.backgroundColor },
        output_format: 'mp4',
        title: `ShortsInShort ${req.idempotencyKey}`.slice(0, 100),
      }),
      signal: req.signal,
    });
    if (!body.data?.video_id) throw new AvatarError('The avatar provider returned no video id.');
    return body.data.video_id;
  }

  async getVideo(videoId: string, signal?: AbortSignal) {
    const body = await this.call<{ data?: { status?: string; video_url?: string | null; duration?: number | null; failure_code?: string; failure_message?: string } }>(
      `/v3/videos/${encodeURIComponent(videoId)}`,
      { signal },
    );
    const d = body.data ?? {};
    const status: AvatarVideoStatus = d.status === 'completed' || d.status === 'failed' || d.status === 'processing' ? d.status : 'pending';
    return {
      status,
      videoUrl: d.video_url ?? null,
      durationSec: typeof d.duration === 'number' ? d.duration : null,
      failure: status === 'failed' ? (d.failure_message ?? d.failure_code ?? 'The avatar video failed at the provider.') : null,
    };
  }

  async download(videoUrl: string, dest: string, signal?: AbortSignal) {
    if (!/^https:\/\//.test(videoUrl)) throw new AvatarError('The avatar provider returned an invalid download link.');
    const res = await fetch(videoUrl, { signal });
    if (!res.ok || !res.body) throw new AvatarError(`Downloading the avatar video failed (HTTP ${res.status}).`);
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(dest));
  }
}

let override: AvatarProvider | null | undefined;

/** Test seam: inject a provider (or null to force "not configured"). Pass undefined to reset. */
export function setAvatarProvider(p: AvatarProvider | null | undefined) {
  override = p;
  avatarCache = null;
}

export function getAvatarProvider(): AvatarProvider | null {
  if (override !== undefined) return override;
  return env.ai.heygen ? new HeyGenProvider(env.ai.heygen.apiKey) : null;
}

let avatarCache: { at: number; avatars: AvatarInfo[] } | null = null;

/** Stock presenters, cached for 30 minutes. */
export async function listAvatarsCached(): Promise<AvatarInfo[]> {
  const p = getAvatarProvider();
  if (!p) return [];
  if (avatarCache && Date.now() - avatarCache.at < 30 * 60_000) return avatarCache.avatars;
  const avatars = await p.listAvatars();
  avatarCache = { at: Date.now(), avatars };
  return avatars;
}
