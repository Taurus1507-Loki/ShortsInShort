import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Captions, CheckCircle2, Coins, Download, Info, Loader2, RotateCcw, Scissors, Sparkles, Timer } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle, Notice, Skeleton } from '../ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/overlays';
import { api, ApiError, errorMessage } from '@/lib/api';
import { keys, queryClient, useAssetUrl, useEstimate, useJob, useMeta } from '@/lib/queries';
import { formatDuration } from '@/lib/upload';
import type { Project } from '@/types/api';

const STAGES: Record<string, string> = {
  queued: 'Waiting in queue',
  starting: 'Starting',
  analyzing: 'Analysing your video',
  transcribing: 'Transcribing speech',
  removing_silence: 'Detecting and removing pauses',
  rendering: 'Rendering your edit',
  finalizing: 'Running quality checks',
  saving: 'Saving your video',
  retrying: 'Hit a snag — retrying',
};

export function RenderPanel({ project, autoOpen, dirty }: { project: Project; autoOpen?: boolean; dirty: boolean }) {
  const busy = project.status === 'queued' || project.status === 'processing';
  const canQuote = project.mode === 'editor' && Boolean(project.sourceAssetId) && !busy;
  const estimate = useEstimate(project.id, canQuote);
  const job = useJob(project.id, busy);
  const [confirm, setConfirm] = useState(false);
  const { data: meta } = useMeta();
  const captionsLive = Boolean(meta?.features.captions);
  const wantsCaptions = project.settings.captionsEnabled;

  useEffect(() => {
    if (autoOpen && canQuote) setConfirm(true);
  }, [autoOpen, canQuote]);

  // When a render finishes, refresh credits/dashboard.
  useEffect(() => {
    if (project.status === 'completed' || project.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: keys.me });
      queryClient.invalidateQueries({ queryKey: keys.dashboard });
    }
  }, [project.status]);

  const generate = useMutation({
    mutationFn: () => api<{ data: { credits: number } }>(`/projects/${project.id}/generate`, { method: 'POST' }),
    onSuccess: (r) => {
      setConfirm(false);
      toast.success(`Rendering started · ${r.data.credits} credit${r.data.credits === 1 ? '' : 's'} used`);
      queryClient.invalidateQueries({ queryKey: keys.project(project.id) });
      queryClient.invalidateQueries({ queryKey: keys.job(project.id) });
      queryClient.invalidateQueries({ queryKey: keys.me });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_CREDITS') toast.error('Not enough credits for this render.');
      else toast.error(errorMessage(e));
    },
  });

  if (project.mode !== 'editor') {
    return (
      <Notice tone="info" title="Generation for this project type isn’t available yet">
        {project.mode === 'avatar' ? 'AI Avatar videos arrive in Phase 3.' : 'Faceless videos arrive in Phase 4.'} Your settings are saved.
      </Notice>
    );
  }

  const e = estimate.data;
  const insufficient = e ? e.balance < e.credits : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Render</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        {/* In progress */}
        {busy && (
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-4" role="status" aria-live="polite">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-highlight" />
              <div className="flex-1">
                <p className="text-sm font-semibold">{STAGES[job.data?.stage ?? project.status] ?? 'Processing'}</p>
                <p className="text-xs text-muted-foreground">
                  {job.data && job.data.attempts > 1 ? `Attempt ${job.data.attempts} of ${job.data.maxAttempts} · ` : ''}
                  You can leave this page — we’ll keep working.
                </p>
              </div>
              <span className="font-display text-lg font-bold">{job.data?.progress ?? 0}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-700" style={{ width: `${job.data?.progress ?? 2}%` }} />
            </div>
          </div>
        )}

        {/* Failed */}
        {project.status === 'failed' && (
          <Notice tone="error" title="Render failed">
            {project.lastError ?? 'Something went wrong.'} Credits for failed renders are refunded automatically.
          </Notice>
        )}

        {/* Result */}
        {project.status === 'completed' && project.outputAsset && <RenderResult project={project} />}

        {/* Generate controls */}
        {!busy && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              {!project.sourceAssetId ? (
                <p className="text-muted-foreground">Upload a video above to render it.</p>
              ) : estimate.isLoading ? (
                <Skeleton className="h-5 w-48" />
              ) : estimate.isError ? (
                <p className="text-destructive">{errorMessage(estimate.error)}</p>
              ) : e ? (
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="flex items-center gap-1.5">
                    <Coins className="h-4 w-4 text-highlight" /> <strong>{e.credits}</strong> credit{e.credits === 1 ? '' : 's'}
                  </span>
                  <span className="text-muted-foreground">Balance: {e.balance}</span>
                </p>
              ) : null}
            </div>
            <Button
              variant="gradient"
              onClick={() => setConfirm(true)}
              disabled={!canQuote || !e || insufficient || !e.resolutionAllowed || dirty}
              title={dirty ? 'Save your changes first' : undefined}
            >
              {project.status === 'completed' ? <RotateCcw /> : <Sparkles />}
              {project.status === 'completed' ? 'Render again' : project.status === 'failed' ? 'Try again' : 'Generate video'}
            </Button>
          </div>
        )}
        {!busy && dirty && <p className="text-xs text-muted-foreground">Save your changes before rendering so they’re included.</p>}
        {e && !e.resolutionAllowed && (
          <Notice tone="warning">
            Your plan exports up to {e.planMaxResolution}. Change the export resolution in Settings below, or{' '}
            <Link to="/app/billing" className="font-semibold underline">
              upgrade
            </Link>
            .
          </Notice>
        )}
        {e && insufficient && (
          <Notice tone="warning">
            This render needs {e.credits} credits and you have {e.balance}.{' '}
            <Link to="/app/billing" className="font-semibold underline">
              See plans
            </Link>
          </Notice>
        )}
      </CardContent>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">Render “{project.title}”?</DialogTitle>
          <DialogDescription asChild>
            <div className="grid gap-3 text-sm text-muted-foreground">
              {e && (
                <dl className="grid gap-2 rounded-lg bg-muted/50 p-4">
                  <div className="flex justify-between">
                    <dt>Source length</dt>
                    <dd className="font-medium text-foreground">{formatDuration(e.sourceDurationSec)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Output</dt>
                    <dd className="font-medium text-foreground">
                      {project.aspectRatio} · {e.resolution}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Cost</dt>
                    <dd className="font-semibold text-foreground">
                      {e.credits} credit{e.credits === 1 ? '' : 's'} (balance after: {e.balance - e.credits})
                    </dd>
                  </div>
                </dl>
              )}
              <p className="flex gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                {captionsLive
                  ? `Removes pauses and filler words, reframes to ${project.aspectRatio}, balances loudness${wantsCaptions ? ' and adds animated captions' : ''}. B-roll and music are coming next and won’t be added yet.`
                  : `Removes pauses, reframes to ${project.aspectRatio} and balances loudness. Captions, B-roll and music are coming next and won’t be added yet.`}
              </p>
              <p>If the render fails, your credits are refunded automatically.</p>
            </div>
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="gradient" loading={generate.isPending} onClick={() => generate.mutate()} disabled={!e || insufficient}>
              <Sparkles /> Confirm & render
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RenderResult({ project }: { project: Project }) {
  const out = project.outputAsset!;
  const video = useAssetUrl(out.id);
  const poster = useAssetUrl(out.thumbnailAssetId);
  const download = useAssetUrl(out.id, true);
  const s = project.renderStats;
  const portrait = (out.height ?? 0) > (out.width ?? 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
      <div className={portrait ? 'mx-auto w-full max-w-[300px]' : 'w-full lg:max-w-[520px]'}>
        {video.data ? (
          <video
            key={video.data}
            src={video.data}
            poster={poster.data}
            controls
            playsInline
            preload="metadata"
            className="w-full rounded-xl border border-border bg-black"
            style={{ aspectRatio: `${out.width} / ${out.height}` }}
            aria-label={`Rendered video: ${project.title}`}
          />
        ) : (
          <Skeleton className="w-full rounded-xl" />
        )}
      </div>
      <div className="grid content-start gap-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-success">
          <CheckCircle2 className="h-4 w-4" /> Ready · {out.width}×{out.height}
        </div>
        {s && (
          <dl className="grid grid-cols-2 gap-3">
            {[
              { icon: Timer, label: 'Length', value: `${formatDuration(s.sourceDurationSec)} → ${formatDuration(s.outputDurationSec)}` },
              { icon: Scissors, label: 'Pauses removed', value: `${s.silenceRemovedSec ?? 0}s · ${s.cuts ?? 0} cuts` },
              ...(s.fillerWordsRemoved ? [{ icon: Scissors, label: 'Filler words cut', value: String(s.fillerWordsRemoved) }] : []),
              ...(s.captionsAdded ? [{ icon: Captions, label: 'Captions', value: 'Added' }] : []),
              ...(s.framing ? [{ icon: Timer, label: 'Background', value: s.framing === 'blur' ? 'Blurred fill' : 'Fill frame' }] : []),
            ].map((x) => (
              <div key={x.label} className="rounded-lg bg-muted/50 p-3">
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <x.icon className="h-3.5 w-3.5" /> {x.label}
                </dt>
                <dd className="mt-1 text-sm font-semibold">{x.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div>
          <Button asChild disabled={!download.data}>
            <a href={download.data ?? '#'} download>
              <Download /> Download MP4
            </a>
          </Button>
        </div>
        {s && s.warnings.length > 0 && (
          <ul className="grid gap-1.5 text-xs text-muted-foreground">
            {s.warnings.map((w) => (
              <li key={w} className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> {w}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
