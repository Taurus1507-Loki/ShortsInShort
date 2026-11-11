import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Clapperboard, ExternalLink, Film, Loader2, Merge, RefreshCw, Scissors, Search, Sparkles, Upload, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input, Textarea } from '../ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Notice } from '../ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useAssetUrl, useJob, useMeta } from '@/lib/queries';
import { uploadVideo } from '@/lib/upload';
import { cn } from '@/lib/utils';
import type { Project, SceneClip } from '@/types/api';
import type { MotionScene } from '@/motion/types';

// Remotion (preview player) is loaded only for Motion Explainer projects.
const MotionPreview = lazy(() => import('./MotionScenes').then((m) => ({ default: m.MotionPreview })));
const MotionThumb = lazy(() => import('./MotionScenes').then((m) => ({ default: m.MotionThumb })));
const MotionEditor = lazy(() => import('./MotionScenes').then((m) => ({ default: m.MotionEditor })));

const STAGES: Record<string, string> = {
  queued: 'Waiting in queue',
  planning_scenes: 'AI is choosing visuals for each scene',
  designing_scenes: 'AI is designing animated scenes',
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

type Mode = 'none' | 'clip' | 'split' | 'words' | 'motion';

/**
 * One scene: its narration and visual, with the editor's tools — move, split, merge, reword,
 * on-screen text, swap the stock clip, re-plan with AI, or use your own video/image.
 */
function SceneCard({ project, index, disabled }: { project: Project; index: number; disabled: boolean }) {
  const scene = project.scenes![index]!;
  const motionStyle = project.settings.facelessStyle === 'motion';
  const total = project.scenes!.length;
  const [mode, setMode] = useState<Mode>('none');
  const [query, setQuery] = useState(scene.queries[0] ?? '');
  const [words, setWords] = useState(scene.text);
  const [overlay, setOverlay] = useState(scene.overlayText);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const ownImage = useAssetUrl(scene.assetType === 'image' ? scene.assetId : null);
  useEffect(() => {
    setWords(scene.text);
    setOverlay(scene.overlayText);
  }, [scene.text, scene.overlayText]);

  const onSaved = (p: Project) => {
    queryClient.setQueryData(keys.project(project.id), p);
    queryClient.invalidateQueries({ queryKey: keys.estimate(project.id) });
  };
  const call = useMutation({
    mutationFn: (req: { path: string; method: 'POST' | 'PATCH'; body?: unknown; note?: string }) =>
      api<{ data: Project; meta?: { found?: number; plannedWith?: string } }>(`/projects/${project.id}/scenes${req.path}`, { method: req.method, body: req.body }).then((r) => ({ ...r, note: req.note })),
    onSuccess: (r) => {
      onSaved(r.data);
      if (r.meta?.found === 0) toast.message('No matching clips — try simpler words, e.g. “city street” or “laptop”.');
      else if (r.note) toast.success(r.note);
      setMode('none');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const edit = (body: unknown, note?: string) => call.mutate({ path: `/${index}`, method: 'PATCH', body, note });
  const busy = disabled || call.isPending || uploading;

  const useOwnMedia = async (file: File) => {
    setUploading(true);
    try {
      const asset = file.type.startsWith('image/') ? await uploadVideo(file, { purpose: 'background' }) : await uploadVideo(file);
      edit({ assetId: asset.id }, 'Your media is used for this scene');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const tokens = scene.text.split(/\s+/).filter(Boolean);

  return (
    <li className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[180px_1fr]">
      <div className="grid content-start gap-1.5">
        {motionStyle ? (
          <Suspense fallback={<div className="aspect-video w-full rounded-md bg-muted" />}>
            <MotionThumb scene={scene} aspect={project.aspectRatio} />
          </Suspense>
        ) : scene.assetId ? (
          scene.assetType === 'image' && ownImage.data ? (
            <img src={ownImage.data} alt="" className="aspect-video w-full rounded-md bg-muted object-cover" />
          ) : (
            <div className="grid aspect-video w-full place-items-center rounded-md bg-muted text-xs text-muted-foreground">Your {scene.assetType}</div>
          )
        ) : (
          <Thumb clip={scene.clip} />
        )}
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move scene ${index + 1} up`} disabled={busy || index === 0} onClick={() => call.mutate({ path: '/move', method: 'POST', body: { from: index, to: index - 1 } })}>
            <ArrowUp />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move scene ${index + 1} down`} disabled={busy || index === total - 1} onClick={() => call.mutate({ path: '/move', method: 'POST', body: { from: index, to: index + 1 } })}>
            <ArrowDown />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Split scene ${index + 1}`} title="Split into two scenes" disabled={busy || tokens.length < 2} onClick={() => setMode(mode === 'split' ? 'none' : 'split')}>
            <Scissors />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Merge scene ${index + 1} with the next`} title="Merge with the next scene" disabled={busy || index === total - 1} onClick={() => call.mutate({ path: `/${index}/merge`, method: 'POST', note: 'Scenes merged' })}>
            <Merge />
          </Button>
        </div>
      </div>

      <div className="grid min-w-0 gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scene {index + 1}</p>

        {mode === 'words' ? (
          <div className="grid gap-2">
            <Textarea aria-label={`Narration for scene ${index + 1}`} value={words} onChange={(e) => setWords(e.target.value)} maxLength={1000} rows={3} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => edit({ text: words.trim() }, 'Scene reworded — generate the voiceover again')} disabled={busy || !words.trim() || words.trim() === scene.text} loading={call.isPending}>
                Save words
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode('none')}>
                Cancel
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Changing words changes the script, so the voiceover must be generated again.</p>
          </div>
        ) : mode === 'split' ? (
          <div className="grid gap-1.5">
            <p className="text-xs text-muted-foreground">Click the word that should start the new scene:</p>
            <p className="flex flex-wrap gap-1 text-sm">
              {tokens.map((w, k) => (
                <button
                  key={k}
                  type="button"
                  disabled={k === 0 || busy}
                  onClick={() => call.mutate({ path: `/${index}/split`, method: 'POST', body: { atWord: k }, note: 'Scene split in two' })}
                  className={cn('rounded px-1', k === 0 ? 'text-muted-foreground' : 'hover:bg-primary hover:text-white')}
                >
                  {w}
                </button>
              ))}
            </p>
          </div>
        ) : (
          <button type="button" className="text-left text-sm hover:text-primary disabled:hover:text-inherit" onClick={() => setMode('words')} disabled={busy} title="Edit the words">
            {scene.text}
          </button>
        )}

        {!motionStyle && (
        <div className="flex items-center gap-2">
          <Input
            aria-label={`On-screen text for scene ${index + 1}`}
            value={overlay}
            maxLength={80}
            onChange={(e) => setOverlay(e.target.value)}
            onBlur={() => overlay.trim() !== scene.overlayText && edit({ overlayText: overlay.trim() }, overlay.trim() ? 'On-screen text saved' : 'On-screen text removed')}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="On-screen text (optional), e.g. “3 habits”"
            className="h-8 text-xs"
            disabled={busy}
          />
        </div>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {motionStyle ? (
            <span>{scene.motion ? `Animation: ${scene.motion.template}` : <span className="text-warning">No animation yet — re-plan or pick a template.</span>}</span>
          ) : scene.assetId ? (
            <span>Your own {scene.assetType}</span>
          ) : scene.clip ? (
            <a href={scene.clip.pageUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-foreground">
              Clip by {scene.clip.author} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-warning">No matching clip yet — search, re-plan or use your own media.</span>
          )}
          {!motionStyle && !scene.assetId && scene.queries[0] && <span>· search: “{scene.queries[0]}”</span>}
          <span className="ml-auto flex flex-wrap gap-1">
            {motionStyle ? (
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setMode(mode === 'motion' ? 'none' : 'motion')} disabled={busy}>
                <RefreshCw /> Edit animation
              </Button>
            ) : (
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setMode(mode === 'clip' ? 'none' : 'clip')} disabled={busy}>
                <RefreshCw /> Change clip
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7" onClick={() => call.mutate({ path: `/${index}/replan`, method: 'POST', note: 'New visuals picked for this scene' })} disabled={busy} loading={call.isPending && call.variables?.path.endsWith('/replan')} title="Let AI pick new visuals for this scene (can take up to a minute)">
              {!(call.isPending && call.variables?.path.endsWith('/replan')) && <Sparkles />} Re-plan
            </Button>
            {motionStyle ? null : scene.assetId ? (
              <Button size="sm" variant="ghost" className="h-7" onClick={() => edit({ assetId: null }, 'Back to stock footage')} disabled={busy}>
                <X /> Remove my media
              </Button>
            ) : (
              <Button size="sm" variant="ghost" className="h-7" onClick={() => fileInput.current?.click()} disabled={busy} loading={uploading}>
                <Upload /> My media
              </Button>
            )}
            <input
              ref={fileInput}
              type="file"
              hidden
              accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void useOwnMedia(f);
                e.target.value = '';
              }}
            />
          </span>
        </div>

        {mode === 'motion' && (
          <Suspense fallback={<p className="text-xs text-muted-foreground">Loading editor…</p>}>
            <MotionEditor scene={scene} saving={call.isPending} onSave={(m: MotionScene) => edit({ motion: m }, 'Animation saved')} />
          </Suspense>
        )}
        {mode === 'clip' && (
          <div className="grid gap-2 rounded-md bg-muted/40 p-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (query.trim().length >= 2) call.mutate({ path: `/${index}/search`, method: 'POST', body: { query: query.trim() } });
              }}
            >
              <Input aria-label={`Search clips for scene ${index + 1}`} value={query} onChange={(e) => setQuery(e.target.value)} maxLength={60} placeholder="Describe what to show, in English" className="h-9" />
              <Button type="submit" size="sm" loading={call.isPending} disabled={query.trim().length < 2 || busy}>
                <Search /> Search
              </Button>
            </form>
            {scene.candidates.length > 0 && (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {scene.candidates.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => edit({ clipId: c.id })}
                      disabled={busy}
                      aria-pressed={!scene.assetId && scene.clip?.id === c.id}
                      className={cn('w-full rounded-md border-2', !scene.assetId && scene.clip?.id === c.id ? 'border-primary' : 'border-transparent hover:border-primary/40')}
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

/** Faceless 4.1/4.2: AI scene plan with a licensed clip per scene, plus the scene editor. */
export function ScenesPanel({ project, dirty, saveFirst }: { project: Project; dirty: boolean; saveFirst: () => Promise<Project> }) {
  const { data: meta } = useMeta();
  const busy = project.status === 'queued' || project.status === 'processing';
  const job = useJob(project.id, busy);
  const planning = busy && job.data?.type === 'plan_scenes';
  const scenes = project.scenes ?? [];
  const motionStyle = project.settings.facelessStyle === 'motion';
  const live = motionStyle || Boolean(meta?.features.stockFootage);
  const needsReplan = scenes.length > 0 && (motionStyle ? scenes.some((sc) => !sc.motion) : scenes.some((sc) => !sc.clip && !sc.assetId));

  const setStyle = useMutation({
    mutationFn: (facelessStyle: 'stock' | 'motion') => api<{ data: Project }>(`/projects/${project.id}`, { method: 'PATCH', body: { settings: { facelessStyle } } }).then((r) => r.data),
    onSuccess: (p) => {
      queryClient.setQueryData(keys.project(project.id), p);
      queryClient.invalidateQueries({ queryKey: keys.estimate(project.id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

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
            Your script is split into short scenes and AI picks matching licensed stock footage for each. Each clip plays exactly while its words are spoken. Planning is free. Edit any scene: move, split, merge, change words, add on-screen text, swap or re-plan its clip, or use your own video or image.
          </CardDescription>
        </div>
        <Button variant={scenes.length ? 'outline' : 'gradient'} className="shrink-0" onClick={() => plan.mutate()} loading={plan.isPending} disabled={!live || busy || !project.script.trim()}>
          <Sparkles /> {scenes.length ? 'Re-plan scenes' : 'Plan scenes with AI'}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Video style">
          {([
            ['stock', 'Stock footage', 'Real licensed video clips for each scene'],
            ['motion', 'Motion Explainer', 'Animated cards, icons, numbers and diagrams in your brand colours'],
          ] as const).map(([id, name, sub]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={project.settings.facelessStyle === id || (!project.settings.facelessStyle && id === 'stock')}
              disabled={busy || dirty || setStyle.isPending}
              onClick={() => project.settings.facelessStyle !== id && setStyle.mutate(id)}
              className={cn('rounded-lg border p-3 text-left text-sm disabled:opacity-60', (project.settings.facelessStyle ?? 'stock') === id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40')}
            >
              <span className="block font-semibold">{name}</span>
              <span className="text-xs text-muted-foreground">{sub}</span>
            </button>
          ))}
        </div>
        {!live && meta && <Notice tone="warning">Stock footage isn’t configured on this server (PIXABAY_API_KEY). Motion Explainer works without it.</Notice>}
        {needsReplan && !busy && <Notice tone="info" title={motionStyle ? 'Plan the animations' : 'Plan the footage'}>Some scenes don’t have {motionStyle ? 'an animation' : 'a clip'} for this style yet. Click “Re-plan scenes”, or set them one by one below.</Notice>}
        {motionStyle && scenes.some((sc) => sc.motion) && !busy && (
          <Suspense fallback={<div className="mx-auto aspect-[9/16] w-full max-w-[300px] rounded-lg bg-muted" />}>
            <MotionPreview scenes={scenes} aspect={project.aspectRatio} language={project.settings.language} />
          </Suspense>
        )}
        {planning && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin text-primary" /> {STAGES[job.data?.stage ?? 'queued'] ?? 'Working'}… {job.data?.progress ?? 0}%
          </p>
        )}
        {project.scenesOutdated && !busy && <Notice tone="warning" title="Scenes are out of date">The script changed since these scenes were planned. Re-plan so every line has a matching clip.</Notice>}
        {project.lastError?.startsWith('Planning scenes failed') && !busy && <Notice tone="error">{project.lastError}</Notice>}
        {dirty && scenes.length > 0 && !busy && <p className="text-xs text-muted-foreground">Save your changes above to edit scenes.</p>}
        {project.scenesPlannedWith === 'keywords' && !busy && scenes.length > 0 && (
          <Notice tone="info" title={motionStyle ? 'Simple text scenes were used' : 'Searches were picked from keywords'}>
            {motionStyle
              ? 'The AI wasn’t available when these scenes were planned, so each scene shows its own narration as text. Re-plan to let AI design them, or edit any animation below.'
              : 'The AI wasn’t available when these scenes were planned, so footage was searched using words from your script. Re-plan to let AI choose, or change any clip below.'}
          </Notice>
        )}
        {scenes.length > 0 ? (
          <ol className="grid gap-2">
            {scenes.map((_, i) => (
              <SceneCard key={`${project.scenesKey}-${i}`} project={project} index={i} disabled={busy || dirty} />
            ))}
          </ol>
        ) : (
          !planning && <p className="text-sm text-muted-foreground">No scenes yet. Write your script above, then plan the scenes.</p>
        )}
      </CardContent>
    </Card>
  );
}
