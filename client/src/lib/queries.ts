import { QueryClient, useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';
import type { Asset, DashboardSummary, Estimate, Job, Meta, Paginated, Project, SessionInfo } from '@/types/api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

export const keys = {
  meta: ['meta'] as const,
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  projects: (params: Record<string, unknown>) => ['projects', params] as const,
  project: (id: string) => ['project', id] as const,
  sessions: ['sessions'] as const,
  assets: (page: number) => ['assets', page] as const,
  assetUrl: (id: string, download: boolean) => ['asset-url', id, download] as const,
  estimate: (id: string) => ['estimate', id] as const,
  job: (id: string) => ['job', id] as const,
};

export const useMeta = () =>
  useQuery({ queryKey: keys.meta, queryFn: () => api<{ data: Meta }>('/meta').then((r) => r.data), staleTime: 5 * 60_000 });

export const useDashboard = () =>
  useQuery({ queryKey: keys.dashboard, queryFn: () => api<{ data: DashboardSummary }>('/dashboard/summary').then((r) => r.data) });

export const useProjects = (params: { page: number; q?: string; status?: string; mode?: string }) =>
  useQuery({
    queryKey: keys.projects(params),
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(params.page), limit: '12' });
      if (params.q) qs.set('q', params.q);
      if (params.status) qs.set('status', params.status);
      if (params.mode) qs.set('mode', params.mode);
      return api<Paginated<Project>>(`/projects?${qs}`);
    },
    placeholderData: (prev) => prev,
  });

export const useProject = (id: string) =>
  useQuery({ queryKey: keys.project(id), queryFn: () => api<{ data: Project }>(`/projects/${id}`).then((r) => r.data) });

export const useSessions = () =>
  useQuery({ queryKey: keys.sessions, queryFn: () => api<{ data: SessionInfo[] }>('/users/me/sessions').then((r) => r.data) });

const BUSY = new Set(['queued', 'processing']);

/** Polls while the project is rendering so status/progress stay live. */
export const useProjectLive = (id: string) =>
  useQuery({
    queryKey: keys.project(id),
    queryFn: () => api<{ data: Project }>(`/projects/${id}`).then((r) => r.data),
    refetchInterval: (q) => (q.state.data && BUSY.has(q.state.data.status) ? 2000 : false),
  });

export const useJob = (projectId: string, active: boolean) =>
  useQuery({
    queryKey: keys.job(projectId),
    queryFn: () => api<{ data: Job | null }>(`/projects/${projectId}/job`).then((r) => r.data),
    refetchInterval: active ? 1500 : false,
  });

export const useEstimate = (projectId: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.estimate(projectId),
    queryFn: () => api<{ data: Estimate }>(`/projects/${projectId}/estimate`).then((r) => r.data),
    enabled,
    staleTime: 0,
  });

/** Signed URLs last 1 hour; refresh well before expiry. */
export const useAssetUrl = (id: string | null | undefined, download = false) =>
  useQuery({
    queryKey: keys.assetUrl(id ?? '', download),
    queryFn: () => api<{ data: { url: string } }>(`/assets/${id}/url${download ? '?download=1' : ''}`).then((r) => r.data.url),
    enabled: Boolean(id),
    staleTime: 40 * 60_000,
    gcTime: 45 * 60_000,
  });

export const useAssets = (page: number) =>
  useQuery({ queryKey: keys.assets(page), queryFn: () => api<Paginated<Asset>>(`/assets?page=${page}`), placeholderData: (p) => p });
