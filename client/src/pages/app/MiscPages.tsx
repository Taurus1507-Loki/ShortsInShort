import { Link } from 'react-router';
import { Check, Construction, LifeBuoy, Mail } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';

/** Honest placeholder for sidebar sections whose phase hasn't been built yet. */
export function ComingSoonPage({ title, phase, description, bullets }: { title: string; phase: number; description: string; bullets: string[] }) {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={title} />
      <Card className="p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-highlight">
          <Construction className="h-6 w-6" />
        </span>
        <Badge variant="muted" className="mt-5">
          Planned for Phase {phase}
        </Badge>
        <p className="mx-auto mt-4 max-w-md text-muted-foreground">{description}</p>
        <ul className="mx-auto mt-6 grid max-w-sm gap-2 text-left text-sm">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> {b}
            </li>
          ))}
        </ul>
        <Button asChild className="mt-8" variant="outline">
          <Link to="/app/new">Set up a draft project meanwhile</Link>
        </Button>
      </Card>
    </div>
  );
}

export function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Help & Support" description="We’re here to help." />
      <div className="grid gap-6 sm:grid-cols-2">
        <Card className="p-6">
          <Mail className="h-5 w-5 text-highlight" />
          <h2 className="mt-4 font-semibold">Email support</h2>
          <p className="mt-1 text-sm text-muted-foreground">Write to us and we’ll get back within one business day.</p>
          <Button asChild variant="outline" className="mt-5">
            <a href="mailto:support@shortsinshort.com">support@shortsinshort.com</a>
          </Button>
        </Card>
        <Card className="p-6">
          <LifeBuoy className="h-5 w-5 text-highlight" />
          <h2 className="mt-4 font-semibold">FAQs & policies</h2>
          <p className="mt-1 text-sm text-muted-foreground">Answers to common questions, plus our terms and privacy policy.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/#faq">FAQs</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/legal/privacy">Privacy</Link>
            </Button>
          </div>
        </Card>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">In-app support tickets are planned with the admin panel (Phase 6).</p>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <p className="font-display text-7xl font-extrabold text-gradient">404</p>
        <h1 className="mt-4 text-2xl font-bold">Page not found</h1>
        <p className="mt-2 text-muted-foreground">The page you’re looking for doesn’t exist or has moved.</p>
        <Button asChild className="mt-6">
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
