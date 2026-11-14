import type { PublicUser } from '@/types/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * The access token lives only in memory (never localStorage) so XSS can't exfiltrate a long-lived
 * credential. The refresh token is an httpOnly cookie the browser sends to /api/auth/refresh.
 */
let accessToken: string | null = null;
let refreshing: Promise<RefreshResult | null> | null = null;
type RefreshResult = { user: PublicUser; accessToken: string };
const sessionListeners = new Set<(r: RefreshResult | null) => void>();

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const onSessionChange = (fn: (r: RefreshResult | null) => void) => {
  sessionListeners.add(fn);
  return () => {
    sessionListeners.delete(fn);
  };
};

/** Single-flight refresh: concurrent 401s share one refresh call (avoids token-reuse detection). */
export function refreshSession(): Promise<RefreshResult | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const { data } = (await res.json()) as { data: RefreshResult };
      accessToken = data.accessToken;
      return data;
    } catch {
      return null;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })().then((r) => {
    sessionListeners.forEach((fn) => fn(r));
    return r;
  });
  return refreshing;
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: Options = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK_ERROR', 'Can’t reach the server. Check your connection and try again.');
  }

  if (res.status === 401 && !retried && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, opts, true);
  }
  if (res.status === 204) return undefined as T;

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? 'Something went wrong.', err.details);
  }
  return json as T;
}

export const errorMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.';

/** Authenticated file download (e.g. invoice PDFs): fetches with the in-memory token and saves it. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  let res = await fetch(`/api${path}`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, credentials: 'same-origin' });
  if (res.status === 401 && (await refreshSession())) {
    res = await fetch(`/api${path}`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, credentials: 'same-origin' });
  }
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'The file could not be downloaded.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

