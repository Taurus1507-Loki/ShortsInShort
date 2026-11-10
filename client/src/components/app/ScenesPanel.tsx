import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clapperboard, ExternalLink, Film, Loader2, RefreshCw, Search, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Notice } from '../ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useJob, useMeta } from '@/lib/queries';
import { cn } from '@/lib/utils';
import type { Project, SceneClip } from '@/types/api';

const STAGES: Record<string, string> = {
  queued: 'Waiting in queue',
  planning_scenes: 'AI is choosing visuals for each scene',
  finding_clips: 'Finding licensed clips',
};

function Thumb({ clip, className }: { clip: SceneClip | null; className?: string }) {
  return clip?.thumbnailUrl ? (
    <img src={clip.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className={cn('aspect-video w-full rounded-md bg-muted object-cover', className)} />
  ) : (
    <div className={cn('grid aspect-video w-full place-items-center rounded-md bg-muted', className)}>
      <Film className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}

/** One scene: its narration, the chosen clip, and a way to search and swap the clip. */
function SceneCard({ project, index, disabled }: { project: Project; index: number; disabled: boolean }) {
  const scene = project.scenes![index]!;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(scene.queries[0] ?? '');
  const onSaved = (p: Project) => queryClient.setQueryData(keys.project(project.id), p);

  const search = useMutation({
    mutationFn: () => api<{ data: Project; meta: { found: number } }>(`/projects/${project.id}/scenes/${index}/search`, { method: 'POST', body: { query: query.trim() } }),
    onSuccess: (r) => {
      onSaved(r.data);
      if (!r.meta.found) toast.message('No matching clips — try simpler words, e.g. “city street” or “laptop”.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pick = useMutation({
    mutationFn: (clipId: string) => api<{ data: Project }>(`/projects/${project.id}/scenes/${index}`, { method: 'PATCH', body: { clipId } }).then((r) => r.data),
    onSuccess: (p) => {
      onSaved(p);
      queryClient.invalidateQueries({ queryKey: keys.estimate(project.id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <li className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[180px_1fr]">
      <Thumb clip={scene.clip} />
      <div className="grid min-w-0 gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scene {index + 1}</p>
        <p className="text-sm">{scene.text}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {scene.clip ? (
            <a href={scene.clip.pageUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-foreground">
              Clip by {scene.clip.author} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-warning">No matching clip yet — search below.</span>
          )}
          {scene.queries[0] && <span>· search: “{scene.queries[0]}”</span>}
          <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => setOpen((o) => !o)} disabled={disabled}>
            <RefreshCw /> Change clip
          </Button>
        </div>
        {open && (
          <div className="grid gap-2 rounded-md bg-muted/40 p-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (query.trim().length >= 2) search.mutate();
              }}
            >
              <Input aria-label={`Search clips for scene ${index + 1}`} value={query} onChange={(e) => setQuery(e.target.value)} maxLength={60} placeholder="Describe what to show, in English" className="h-9" />
              <Button type="submit" size="sm" loading={search.isPending} disabled={query.trim().length < 2 || disabled}>
                <Search /> Search
              </Button>
            </form>
            {scene.candidates.length > 0 && (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {scene.candidates.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => pick.mutate(c.id)}
                      disabled={pick.isPending || disabled}
                      aria-pressed={scene.clip?.id === c.id}
                      className={cn('w-full rounded-md border-2', scene.clip?.id === c.id ? 'border-primary' : 'border-transparent hover:border-primary/40')}
                    >
                      <Thumb clip={c} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">Licensed stock footage (Pixabay). Only clips whose tags match your words are shown.</p>
          </div>
        )}
      </div>
    </li>
  );
}

/** Faceless step 4.1: AI scene plan with a licensed clip per scene, editable before rendering. */
export function ScenesPanel({ project, dirty, saveFirst }: { project: Project; dirty: boolean; saveFirst: () => Promise<Project> }) {
  const { data: meta } = useMeta();
  const busy = project.status === 'queued' || project.status === 'processing';
  const job = useJob(project.id, busy);
  const planning = busy && job.data?.type === 'plan_scenes';
  const scenes = project.scenes ?? [];
  const live = Boolean(meta?.features.facelessCreator);

  const plan = useMutation({
    mutationFn: async () => {
      if (dirty) await saveFirst();
      return api(`/projects/${project.id}/scenes/plan`, { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.project(project.id) });
      queryClient.invalidateQueries({ queryKey: keys.job(project.id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Clapperboard className="h-5 w-5 text-primary" /> Scenes
          </CardTitle>
          <CardDescription className="mt-1.5">
            Your script is split into short scenes and AI picks matching licensed stock footage for each. Each clip plays exactly while its words are spoken. Planning is free.
          </CardDescription>
        </div>
        <Button variant={scenes.length ? 'outline' : 'gradient'} className="shrink-0" onClick={() => plan.mutate()} loading={plan.isPending} disabled={!live || busy || !project.script.trim()}>
          <Sparkles /> {scenes.length ? 'Re-plan scenes' : 'Plan scenes with AI'}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!live && meta && <Notice tone="warning">Stock footage isn’t configured on this server (PIXABAY_API_KEY).</Notice>}
        {planning && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin text-primary" /> {STAGES[job.data?.stage ?? 'queued'] ?? 'Working'}… {job.data?.progress ?? 0}%
          </p>
        )}
        {project.scenesOutdated && !busy && <Notice tone="warning" title="Scenes are out of date">The script changed since these scenes were planned. Re-plan so every line has a matching clip.</Notice>}
        {project.lastError?.startsWith('Planning scenes failed') && !busy && <Notice tone="error">{project.lastError}</Notice>}
        {project.scenesPlannedWith === 'keywords' && !busy && scenes.length > 0 && (
          <Notice tone="info" title="Searches were picked from keywords">
            The AI wasn’t available when these scenes were planned, so footage was searched using words from your script. Re-plan to let AI choose, or change any clip below.
          </Notice>
        )}
        {scenes.length > 0 ? (
          <ol className="grid gap-2">
            {scenes.map((_, i) => (
              <SceneCard key={`${project.scenesKey}-${i}`} project={project} index={i} disabled={busy} />
            ))}
          </ol>
        ) : (
          !planning && <p className="text-sm text-muted-foreground">No scenes yet. Write your script above, then plan the scenes.</p>
        )}
      </CardContent>
    </Card>
  );
}
