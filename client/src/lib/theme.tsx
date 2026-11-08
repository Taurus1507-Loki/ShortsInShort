import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light' | 'system';
const KEY = 'sis-theme';

const ThemeContext = createContext<{ theme: Theme; resolved: 'dark' | 'light'; setTheme: (t: Theme) => void } | null>(null);

const systemPrefersLight = () => window.matchMedia('(prefers-color-scheme: light)').matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(KEY) as Theme) || 'dark';
    } catch {
      return 'dark';
    }
  });
  const [resolved, setResolved] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const apply = () => {
      const r = theme === 'system' ? (systemPrefersLight() ? 'light' : 'dark') : theme;
      document.documentElement.classList.toggle('dark', r === 'dark');
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', r === 'dark' ? '#080B14' : '#F8FAFC');
      setResolved(r);
    };
    apply();
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* storage unavailable — theme still applies for this visit */
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
