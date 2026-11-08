import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, PlusCircle, Search } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { ProjectCard } from '@/components/app/projects';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Notice, Skeleton } from '@/components/ui/primitives';
import { useProjects } from '@/lib/queries';
import { MODES, STATUS_META } from '@/config/options';
import { errorMessage } from '@/lib/api';

export default function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const status = params.get('status') ?? '';
  const mode = params.get('mode') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');

  // Debounce search input into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (q) next.set('q', q);
      else next.delete('q');
      if ((params.get('q') ?? '') !== q) {
        next.delete('page');
        setParams(next, { replace: true });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, params, setParams]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  };

  const { data, isLoading, isError, error, isFetching } = useProjects({ page, q: params.get('q') ?? undefined, status: status || undefined, mode: mode || undefined });
  const filtered = Boolean(params.get('q') || status || mode);

  return (
    <>
      <PageHeader
        title="My Projects"
        description={data ? `${data.meta.total} project${data.meta.total === 1 ? '' : 's'}` : undefined}
        actions={
          <Button asChild>
            <Link to="/app/new">
              <PlusCircle /> New project
            </Link>
          </Button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-[1fr_180px_180px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" className="pl-9" aria-label="Search projects" />
        </div>
        <Select value={status} onChange={(e) => setFilter('status', e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Select value={mode} onChange={(e) => setFilter('mode', e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </div>

      {isError && <Notice tone="error">{errorMessage(error)}</Notice>}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : data && data.data.length > 0 ? (
        <>
          <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${isFetching ? 'opacity-70' : ''}`}>
            {data.data.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
          {data.meta.totalPages > 1 && (
            <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setFilter('page', String(page - 1))}>
                <ChevronLeft /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {data.meta.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setFilter('page', String(page + 1))}>
                Next <ChevronRight />
              </Button>
            </nav>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="font-semibold">{filtered ? 'No projects match your filters' : 'No projects yet'}</p>
          <p className="mt-1 text-sm text-muted-foreground">{filtered ? 'Try a different search or filter.' : 'Create a project to start building your first video.'}</p>
          {!filtered && (
            <Button asChild className="mt-5">
              <Link to="/app/new">Create a project</Link>
            </Button>
          )}
        </div>
      )}
    </>
  );
}
