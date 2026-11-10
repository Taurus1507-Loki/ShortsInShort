import { Link } from 'react-router';
import { AlertTriangle, ArrowRight, CheckCircle2, Coins, Film, HardDrive, Loader, Sparkles, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { ProjectRow } from '@/components/app/projects';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Notice, Skeleton } from '@/components/ui/primitives';
import { useAuth } from '@/features/auth/AuthProvider';
import { useDashboard } from '@/lib/queries';
import { MODES } from '@/config/options';
import { formatBytes } from '@/lib/utils';
import { errorMessage } from '@/lib/api';

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Coins; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 text-highlight">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 font-display text-3xl font-extrabold">{value}</p>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading, isError, error, refetch } = useDashboard();
  const firstName = user?.fullName.split(' ')[0];

  return (
    <>
      <PageHeader
        title={`Welcome${firstName ? `, ${firstName}` : ''}`}
        description="Here’s what’s happening in your workspace."
        actions={
          <Button asChild variant="gradient">
            <Link to="/app/new">
              <Sparkles /> Create video
            </Link>
          </Button>
        }
      />

      {isError && (
        <Notice tone="error" title="Couldn’t load your dashboard" className="mb-6">
          {errorMessage(error)}{' '}
          <button className="font-semibold underline" onClick={() => refetch()}>
            Retry
          </button>
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[132px] rounded-xl" />)
        ) : (
          <>
            <Stat icon={Film} label="Total videos" value={data.projects.total} sub={`${data.projects.byStatus.draft} draft`} />
            <Stat
              icon={Coins}
              label="Remaining credits"
              value={data.credits.balance}
              sub={data.credits.balance <= 1 ? <span className="text-warning">Running low</span> : `${data.plan.monthlyCredits} included in ${data.plan.name}`}
            />
            <Stat icon={TrendingUp} label="Used this month" value={data.credits.usedThisMonth} sub="credits" />
            <Stat
              icon={HardDrive}
              label="Storage"
              value={formatBytes(data.storage.usedBytes)}
              sub={
                <div className="grid gap-1.5">
                  <span>of {formatBytes(data.storage.limitBytes)}</span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${Math.min(100, (data.storage.usedBytes / data.storage.limitBytes) * 100)}%` }} />
                  </div>
                </div>
              }
            />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent projects</CardTitle>
            <Button asChild variant="link" size="sm">
              <Link to="/app/projects">
                View all <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-2">
            {isLoading ? (
              <div className="grid gap-2 px-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
            ) : data && data.recentProjects.length > 0 ? (
              <div className="grid">
                {data.recentProjects.map((p) => (
                  <ProjectRow key={p.id} project={p} />
                ))}
              </div>
            ) : (
              <div className="px-3 py-10 text-center">
                <p className="font-semibold">No projects yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Create your first project to get started.</p>
                <Button asChild className="mt-4">
                  <Link to="/app/new">Create a project</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Processing jobs</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3 text-center">
              {[
                { icon: Loader, label: 'In progress', value: (data?.projects.byStatus.processing ?? 0) + (data?.projects.byStatus.queued ?? 0), cls: 'text-warning' },
                { icon: CheckCircle2, label: 'Completed', value: data?.projects.byStatus.completed ?? 0, cls: 'text-success' },
                { icon: AlertTriangle, label: 'Failed', value: data?.projects.byStatus.failed ?? 0, cls: 'text-destructive' },
              ].map((j) => (
                <div key={j.label} className="rounded-lg bg-muted/50 p-3">
                  <j.icon className={`mx-auto h-4 w-4 ${j.cls}`} />
                  <p className="mt-2 font-display text-xl font-bold">{isLoading ? '–' : j.value}</p>
                  <p className="text-xs text-muted-foreground">{j.label}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Start something new</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {MODES.map((m) => (
                <Link key={m.id} to={`/app/new?mode=${m.id}`} className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/40">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-highlight">
                    <m.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {m.name}
                      {m.id === 'faceless' && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Phase {m.phase}</span>}{m.id === 'avatar' && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">New</span>}
                    </span>
                    <span className="block line-clamp-2 text-xs text-muted-foreground">{m.description}</span>
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
