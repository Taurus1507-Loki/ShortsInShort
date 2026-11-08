import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';
import { Logo, ThemeToggle } from '../brand';
import { Button } from '../ui/button';
import { useAuth } from '@/features/auth/AuthProvider';
import { cn } from '@/lib/utils';

const NAV = [
  { label: 'Features', href: '/#features' },
  { label: 'How It Works', href: '/#how-it-works' },
  { label: 'Templates', href: '/#templates' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'FAQs', href: '/#faq' },
];

function Navbar() {
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.hash]);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-colors duration-300',
        scrolled || open ? 'glass border-b border-border/70' : 'border-b border-transparent',
      )}
    >
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <nav className="container flex h-16 items-center justify-between gap-4" aria-label="Main">
        <Logo />
        <ul className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <li key={n.href}>
              <a href={n.href} className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                {n.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          {status === 'authenticated' ? (
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link to="/app">Open dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link to="/login">Login</Link>
              </Button>
              <Button asChild variant="gradient" size="sm" className="hidden sm:inline-flex">
                <Link to="/register">Start Creating Free</Link>
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="lg:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </nav>
      {open && (
        <div id="mobile-nav" className="container pb-5 lg:hidden">
          <ul className="grid gap-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} className="block rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {status === 'authenticated' ? (
              <Button asChild className="col-span-2">
                <Link to="/app">Open dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="outline">
                  <Link to="/login">Login</Link>
                </Button>
                <Button asChild variant="gradient">
                  <Link to="/register">Start free</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  const cols = [
    { title: 'Product', links: [['Features', '/#features'], ['How it works', '/#how-it-works'], ['Templates', '/#templates'], ['Pricing', '/#pricing']] },
    { title: 'Company', links: [['FAQs', '/#faq'], ['Contact', 'mailto:support@shortsinshort.com']] },
    {
      title: 'Legal',
      links: [
        ['Terms', '/legal/terms'],
        ['Privacy', '/legal/privacy'],
        ['Refunds', '/legal/refunds'],
        ['Acceptable use', '/legal/acceptable-use'],
        ['AI disclosure', '/legal/ai-disclosure'],
      ],
    },
  ];
  return (
    <footer className="border-t border-border">
      <div className="container grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-sm text-muted-foreground">Your Script. Your AI Editor. Your Video. Done.</p>
          <p className="mt-2 text-xs text-muted-foreground">Made in India · Prices in INR</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h3 className="text-sm font-semibold">{c.title}</h3>
            <ul className="mt-4 grid gap-2.5">
              {c.links.map(([label, href]) => (
                <li key={href}>
                  {href!.startsWith('/legal') ? (
                    <Link to={href!} className="text-sm text-muted-foreground hover:text-foreground">
                      {label}
                    </Link>
                  ) : (
                    <a href={href} className="text-sm text-muted-foreground hover:text-foreground">
                      {label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <p className="container py-6 text-xs text-muted-foreground">© {year} ShortsInShort. All rights reserved.</p>
      </div>
    </footer>
  );
}

export function MarketingLayout() {
  const { hash, pathname } = useLocation();
  // Support in-page anchors after client-side navigation (e.g. /legal → /#pricing).
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [hash, pathname]);
  return (
    <div className="flex min-h-dvh flex-col">
      <Navbar />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
