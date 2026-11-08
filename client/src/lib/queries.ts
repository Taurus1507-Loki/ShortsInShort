import { QueryClient, useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';
import type { DashboardSummary, Meta, Paginated, Project, SessionInfo } from '@/types/api';

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
