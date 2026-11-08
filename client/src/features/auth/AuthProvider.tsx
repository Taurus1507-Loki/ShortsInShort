import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, onSessionChange, refreshSession, setAccessToken } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import type { PublicUser, WorkspaceSummary } from '@/types/api';

type Status = 'loading' | 'authenticated' | 'anonymous';
interface AuthResponse {
  data: { user: PublicUser; accessToken: string };
}

interface AuthContextValue {
  status: Status;
  user: PublicUser | null;
  workspace: WorkspaceSummary | null;
  login: (email: string, password: string) => Promise<PublicUser>;
  register: (input: { fullName: string; email: string; password: string; acceptTerms: true }) => Promise<PublicUser>;
  logout: () => Promise<void>;
  setUser: (u: PublicUser) => void;
  /** Re-reads the session from the server (e.g. after OAuth redirect or email verification). */
  reload: () => Promise<boolean>;
  clear: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<PublicUser | null>(null);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUserState(null);
    setStatus('anonymous');
    queryClient.clear();
  }, []);

  const reload = useCallback(async () => {
    const r = await refreshSession();
    if (r) {
      setUserState(r.user);
      setStatus('authenticated');
      queryClient.invalidateQueries({ queryKey: keys.me });
      return true;
    }
    setStatus('anonymous');
    return false;
  }, []);

  // Restore session on first load from the httpOnly refresh cookie.
  useEffect(() => {
    void reload();
  }, [reload]);

  // If a background refresh fails (session revoked elsewhere), sign out locally.
  useEffect(
    () =>
      onSessionChange((r) => {
        if (r) setUserState(r.user);
        else if (status === 'authenticated') clear();
      }),
    [status, clear],
  );

  const onAuthed = useCallback((res: AuthResponse) => {
    setAccessToken(res.data.accessToken);
    setUserState(res.data.user);
    setStatus('authenticated');
    queryClient.invalidateQueries();
    return res.data.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => onAuthed(await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } })),
    [onAuthed],
  );

  const register = useCallback<AuthContextValue['register']>(
    async (input) => onAuthed(await api<AuthResponse>('/auth/register', { method: 'POST', body: input })),
    [onAuthed],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      clear();
    }
  }, [clear]);

  const me = useQuery({
    queryKey: keys.me,
    enabled: status === 'authenticated',
    queryFn: () => api<{ data: { user: PublicUser; workspace: WorkspaceSummary } }>('/auth/me').then((r) => r.data),
  });

  useEffect(() => {
    if (me.data?.user) setUserState(me.data.user);
  }, [me.data]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      workspace: me.data?.workspace ?? null,
      login,
      register,
      logout,
      setUser: setUserState,
      reload,
      clear,
    }),
    [status, user, me.data, login, register, logout, reload, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
