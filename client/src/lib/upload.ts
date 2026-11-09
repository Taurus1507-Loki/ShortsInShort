import { api, ApiError } from './api';
import type { Asset } from '@/types/api';

export const ACCEPTED_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv'];
export const ACCEPT_ATTR = 'video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.m4v,.webm,.mkv';

/** Reads duration in the browser so obviously-too-long files fail before uploading. */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null); // some containers (e.g. MKV) can't be read by every browser — server validates anyway
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}

/** PUTs bytes to the signed URL with progress; XHR because fetch has no upload progress events. */
function putWithProgress(url: string, file: File, headers: Record<string, string>, onProgress: (f: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError(xhr.status, xhr.status === 413 ? 'TOO_LARGE' : 'UPLOAD_FAILED', xhr.status === 413 ? 'That file is too large.' : 'Upload failed. Please try again.'));
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Upload interrupted. Check your connection and try again.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export type UploadPhase = 'preparing' | 'uploading' | 'verifying';

/** initiate (server registers asset + signed URL) → PUT bytes directly to storage → complete (server validates). */
export async function uploadVideo(file: File, opts: { onPhase?: (p: UploadPhase) => void; onProgress?: (f: number) => void; signal?: AbortSignal; purpose?: 'video' | 'logo' } = {}): Promise<Asset> {
  opts.onPhase?.('preparing');
  const init = await api<{ data: { asset: Asset; upload: { url: string; headers: Record<string, string> } } }>('/assets/uploads', {
    method: 'POST',
    body: { filename: file.name, contentType: file.type || (opts.purpose === 'logo' ? 'image/png' : 'video/mp4'), sizeBytes: file.size, ...(opts.purpose === 'logo' ? { purpose: 'logo' } : {}) },
    signal: opts.signal,
  });
  opts.onPhase?.('uploading');
  await putWithProgress(init.data.upload.url, file, init.data.upload.headers, (f) => opts.onProgress?.(f), opts.signal);
  opts.onPhase?.('verifying');
  const done = await api<{ data: Asset }>(`/assets/${init.data.asset.id}/complete`, { method: 'POST', signal: opts.signal });
  return done.data;
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '–';
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}
