import { Link } from 'react-router';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/overlays';
import { Button } from './ui/button';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('h-8 w-8', className)} aria-hidden>
      <defs>
        <linearGradient id="sis-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7C3AED" />
          <stop offset="0.55" stopColor="#A78BFA" />
          <stop offset="1" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#sis-g)" />
      <rect x="8" y="7" width="9" height="18" rx="2.5" fill="white" fillOpacity="0.25" />
      <path d="M13 11.5 22.5 16 13 20.5z" fill="white" />
    </svg>
  );
}

export function Logo({ to = '/', className }: { to?: string; className?: string }) {
  return (
    <Link to={to} className={cn('flex items-center gap-2.5 rounded-lg', className)} aria-label="ShortsInShort home">
      <LogoMark />
      <span className="font-display text-lg font-extrabold tracking-tight">
        Shorts<span className="text-gradient">In</span>Short
      </span>
    </Link>
  );
}

const themeIcons: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

export function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  const Icon = resolved === 'dark' ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change colour theme">
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        {(['light', 'dark', 'system'] as Theme[]).map((t) => {
          const I = themeIcons[t];
          return (
            <DropdownMenuItem key={t} onSelect={() => setTheme(t)} className={cn(theme === t && 'text-highlight')}>
              <I /> {t[0]!.toUpperCase() + t.slice(1)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
