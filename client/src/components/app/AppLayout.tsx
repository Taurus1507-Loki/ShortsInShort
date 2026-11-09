import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  Clapperboard,
  CreditCard,
  FolderKanban,
  Image,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  LogOut,
  Menu,
  Palette,
  PlusCircle,
  Settings,
  Sparkles,
  UserRound,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { Logo, ThemeToggle } from '../brand';
import { Button } from '../ui/button';
import { Dialog, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, SheetContent } from '../ui/overlays';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import { useMeta } from '@/lib/queries';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  soon?: boolean;
}

const NAV: { section?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/app/new', label: 'Create Video', icon: PlusCircle },
    ],
  },
  {
    section: 'Create',
    items: [
      { to: '/app/new?mode=editor', label: 'AI Video Editor', icon: Wand2 },
      { to: '/app/avatar', label: 'AI Avatar', icon: UserRound, soon: true },
      { to: '/app/faceless', label: 'Faceless Videos', icon: Clapperboard, soon: true },
    ],
  },
  {
    section: 'Library',
    items: [
      { to: '/app/projects', label: 'My Projects', icon: FolderKanban },
      { to: '/app/templates', label: 'Templates', icon: LayoutTemplate, soon: true },
      { to: '/app/brand-kit', label: 'Brand Kit', icon: Palette },
      { to: '/app/media', label: 'Media Library', icon: Image },
    ],
  },
  {
    section: 'Account',
    items: [
      { to: '/app/billing', label: 'Subscription & Billing', icon: CreditCard },
      { to: '/app/settings', label: 'Account Settings', icon: Settings },
      { to: '/app/help', label: 'Help & Support', icon: LifeBuoy },
    ],
  },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { workspace } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Logo to="/app" />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="App">
        {NAV.map((group, gi) => (
          <div key={gi} className="mt-4 first:mt-1">
            {group.section && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{group.section}</p>}
            <ul className="grid gap-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={cn('h-4 w-4', isActive && 'text-highlight')} />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.soon && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Soon</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {workspace && (
        <div className="m-3 rounded-xl border border-border bg-card/70 p-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">{workspace.planName} plan</span>
            <span className="text-muted-foreground">{workspace.creditBalance} credits</span>
          </div>
          <Button asChild size="sm" variant="gradient" className="mt-3 w-full">
            <Link to="/app/billing" onClick={onNavigate}>
              <Sparkles /> Upgrade
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const initials = user.fullName
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-muted/60" aria-label="Account menu">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-gradient text-xs font-bold text-white">{initials}</span>
          )}
          <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:block">{user.fullName}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-semibold">{user.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/app/settings')}>
          <Settings /> Account settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/app/billing')}>
          <CreditCard /> Billing
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await logout();
            navigate('/', { replace: true });
          }}
        >
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VerifyEmailBanner() {
  const { user } = useAuth();
  const { data: meta } = useMeta();
  const [sending, setSending] = useState(false);
  if (!user || user.emailVerified) return null;
  // Without SMTP (development), emails are written to the API server's log instead of being sent.
  const devLog = meta?.emailDelivery === 'dev-log';
  return (
    <div className="border-b border-warning/30 bg-warning/10 px-4 py-2.5 text-sm sm:px-6" role="status">
      <span className="font-medium">Verify your email</span>
      {devLog ? (
        <span className="text-muted-foreground">
          {' '}
          — email delivery isn’t configured on this server yet, so the verification link for {user.email} is printed in the API server’s terminal (look for “DEV EMAIL”).{' '}
        </span>
      ) : (
        <span className="text-muted-foreground"> — we sent a link to {user.email}. Verifying unlocks project creation and your free credits. </span>
      )}
      <button
        className="font-semibold text-highlight underline-offset-2 hover:underline disabled:opacity-50"
        disabled={sending}
        onClick={async () => {
          setSending(true);
          try {
            await api('/auth/resend-verification', { method: 'POST' });
            toast.success(devLog ? 'New link created — check the API server terminal.' : 'Verification email sent.');
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setSending(false);
          }
        }}
      >
        Resend email
      </button>
    </div>
  );
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { workspace } = useAuth();
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh border-r border-border bg-surface/60 lg:block">
        <SidebarNav />
      </aside>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent aria-describedby={undefined}>
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Dialog>

      <div className="flex min-w-0 flex-col">
        <header className="glass sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border px-4 sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <div className="flex-1" />
          {workspace && (
            <Link to="/app/billing" className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold sm:flex">
              <Sparkles className="h-3.5 w-3.5 text-highlight" /> {workspace.creditBalance} credits
            </Link>
          )}
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link to="/app/new">
              <PlusCircle /> New video
            </Link>
          </Button>
          <ThemeToggle />
          <UserMenu />
        </header>
        <VerifyEmailBanner />
        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-extrabold sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
