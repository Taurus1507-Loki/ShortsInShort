import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, Coins, Save } from 'lucide-react';
import { DeleteProjectButton } from '@/components/app/ProjectActions';
import { MotionThemePicker } from '@/components/app/MotionThemePicker';
const MotionPreview = lazy(() => import('@/components/app/MotionScenes').then((m) => ({ default: m.MotionPreview })));
import { CustomizeForm, DEFAULT_SETTINGS, StatusBadge, type CustomizeValue } from '@/components/app/projects';
import { CaptionEditor } from '@/components/app/CaptionEditor';
import { LivePreview } from '@/components/app/LivePreview';
import { RenderPanel } from '@/components/app/RenderPanel';
import { VoiceoverPanel } from '@/components/app/VoiceoverPanel';
import { BackgroundPicker, PresenterPicker, ScriptAssist } from '@/components/app/AvatarControls';
import { ScenesPanel } from '@/components/app/ScenesPanel';
import { VideoUploader } from '@/components/app/VideoUploader';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Skeleton } from '@/components/ui/primitives';
import { keys, queryClient, useMeta, useProjectLive } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { modeName } from '@/config/options';
import { cn, timeAgo } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { FLOWS, resumeStep, stepBlocker, stepDone, stepPrice, stepsFor, type StudioStep } from '@/features/studio';
import type { Asset, Project, ProjectSettings } from '@/types/api';

/**
 * The project studio: one page per step (/app/projects/:id/:step). Edits are saved when you move to
 * another step, so every page starts from the saved project. Steps that cost credits show the price
 * before anything is charged, and redoing a step only charges that step.
 */
export default function ProjectDetailPage() {
  const { id = '', step: stepParam } = useParams();
  const navigate = useNavigate();
  const { data: project, isLoading, isError, error } = useProjectLive(id);
  const { data: meta } = useMeta();
  const { workspace } = useAuth();

  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  const [custom, setCustom] = useState<CustomizeValue | null>(null);

  // Sync the form from the server, but don't clobber unsaved edits during status polling. "Unsaved"
  // means the user changed the form since it was last loaded — not that the server changed (e.g. the
  // Scenes step switching to animated scenes), which must flow into the form.
  const [loaded, setLoaded] = useState<Project | null>(null);
  const differs = (p: Project) =>
    !!custom &&
    (title !== p.title || script !== p.script || JSON.stringify(custom) !== JSON.stringify({ style: p.style, aspectRatio: p.aspectRatio, settings: p.settings }));
  useEffect(() => {
    if (!project) return;
    const userEdited = loaded ? differs(loaded) : false;
    if (!loaded || (loaded.updatedAt !== project.updatedAt && !userEdited)) {
      setTitle(project.title);
      setScript(project.script);
      setCustom({ style: project.style, aspectRatio: project.aspectRatio, settings: project.settings });
      setLoaded(project);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  /** Unsaved: the form doesn't match what the server has now. */
  const isDirty = () => !!project && differs(project);

  const onSaved = (p: Project) => {
    queryClient.setQueryData(keys.project(id), p);
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: keys.dashboard });
    queryClient.invalidateQueries({ queryKey: keys.estimate(id) });
    queryClient.invalidateQueries({ queryKey: keys.narrationEstimate(id) });
  };

  const save = useMutation({
    mutationFn: () =>
      api<{ data: Project }>(`/projects/${id}`, {
        method: 'PATCH',
        body: { title: title.trim(), script, style: custom!.style, aspectRatio: custom!.aspectRatio, settings: custom!.settings },
      }).then((r) => r.data),
    onSuccess: (p) => {
      onSaved(p);
      setTitle(p.title);
      setScript(p.script);
      setCustom({ style: p.style, aspectRatio: p.aspectRatio, settings: p.settings });
      setLoaded(p);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const attach = useMutation({
    mutationFn: (asset: Asset) => api<{ data: Project }>(`/projects/${id}`, { method: 'PATCH', body: { sourceAssetId: asset.id } }).then((r) => r.data),
    onSuccess: (p) => {
      onSaved(p);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      toast.success('Video attached');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const attachBackground = useMutation({
    mutationFn: (asset: Asset | null) => api<{ data: Project }>(`/projects/${id}`, { method: 'PATCH', body: { backgroundAssetId: asset?.id ?? null } }).then((r) => r.data),
    onSuccess: (p) => {
      queryClient.setQueryData(keys.project(id), (old: Project | undefined) => (old ? { ...old, backgroundAssetId: p.backgroundAssetId, backgroundAsset: p.backgroundAsset } : p));
      queryClient.invalidateQueries({ queryKey: keys.estimate(id) });
      toast.success('Background saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) {
    return (
      <div className="mx-auto grid max-w-4xl gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (isError || !project || !custom) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="text-lg font-semibold">Project not found</p>
        <p className="mt-1 text-sm text-muted-foreground">{errorMessage(error)}</p>
        <Button asChild className="mt-6" variant="outline">
          <Link to="/app/projects">Back to projects</Link>
        </Button>
      </div>
    );
  }

  const flow = FLOWS[project.mode];
  const step = stepParam as StudioStep | undefined;
  if (!step || !flow.includes(step)) return <Navigate to={`/app/projects/${project.id}/${resumeStep(project)}`} replace />;

  const steps = stepsFor(project.mode);
  const index = flow.indexOf(step);
  const info = steps[index]!;
  const busy = project.status === 'queued' || project.status === 'processing';
  const dirty = isDirty();
  const settings: ProjectSettings = { ...DEFAULT_SETTINGS, ...custom.settings };
  const setSettings = (patch: Partial<ProjectSettings>) => setCustom({ ...custom, settings: { ...custom.settings, ...patch } });
  const price = stepPrice(meta, project, step);
  // Judge the page you're on by what you see: unsaved text counts on the Script step, and a changed
  // voice, language or speed means the voiceover has to be made again.
  const blocker =
    step === 'script'
      ? script.trim().length === 0
        ? 'Write or generate a script to continue.'
        : script.trim().length > 5000
          ? 'Shorten the script to 5,000 characters or fewer.'
          : null
      : step === 'voice' && dirty
        ? 'Generate the voiceover with your changes to continue.'
        : stepBlocker(project, step);
  const next = steps[index + 1];
  const prev = steps[index - 1];

  /** Moves to another step, saving unsaved edits first. */
  const go = async (to: StudioStep) => {
    if (dirty) {
      if (!title.trim()) return toast.error('Give your project a title first.');
      try {
        await save.mutateAsync();
      } catch {
        return;
      }
    }
    navigate(`/app/projects/${project.id}/${to}`);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/app/projects" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Projects
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-extrabold sm:text-3xl">{project.title}</h1>
            {/* "Completed" means the video exists; a finished voiceover or scene plan is still a draft. */}
            <StatusBadge status={project.status === 'completed' && !project.outputAsset ? 'draft' : project.status} />
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {modeName(project.mode)} · created {timeAgo(project.createdAt)} · last edited {timeAgo(project.updatedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <DeleteProjectButton project={project} size="default" onDeleted={() => navigate('/app/projects', { replace: true })} />
          <Button
            variant="outline"
            onClick={() => save.mutate(undefined, { onSuccess: () => toast.success('Changes saved') })}
            loading={save.isPending}
            disabled={!dirty || !title.trim() || busy}
          >
            <Save /> Save
          </Button>
        </div>
      </div>

      {/* Step bar */}
      <nav aria-label="Steps" className="mb-6 rounded-xl border border-border bg-card p-3">
        <ol className="flex gap-1 overflow-x-auto">
          {steps.map((s, i) => {
            const done = stepDone(project, s.id);
            const current = s.id === step;
            return (
              <li key={s.id} className="min-w-[88px] flex-1">
                <button
                  type="button"
                  onClick={() => !current && go(s.id)}
                  aria-current={current ? 'step' : undefined}
                  className={cn('w-full rounded-lg px-2 py-2 text-left transition-colors', current ? 'bg-primary/15' : 'hover:bg-muted/60')}
                >
                  <span className={cn('block h-1 rounded-full', current || done ? 'bg-brand-gradient' : 'bg-muted')} />
                  <span className={cn('mt-2 flex items-center gap-1.5 text-xs font-semibold', current ? 'text-foreground' : 'text-muted-foreground')}>
                    <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px]', done ? 'bg-success/20 text-success' : current ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                      {done ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    <span className="truncate">{s.label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {workspace && (
          <p className="mt-2 flex items-center justify-end gap-1.5 px-2 text-xs text-muted-foreground">
            <Coins className="h-3.5 w-3.5 text-highlight" /> {workspace.creditBalance.toLocaleString()} credits left
          </p>
        )}
      </nav>

      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Step {index + 1} of {steps.length}
          </p>
          <h2 className="text-xl font-bold">{info.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{info.blurb}</p>
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-1.5 self-start rounded-full px-3 py-1 text-xs font-semibold sm:self-auto', price.free ? 'bg-success/15 text-success' : 'bg-primary/15 text-foreground')}>
          <Coins className="h-3.5 w-3.5" /> {price.text}
        </span>
      </div>

      <div className="grid gap-6">
        {step === 'footage' && (
          <fieldset disabled={busy} className="grid gap-6 disabled:opacity-60">
            <Card>
              <CardHeader>
                <CardTitle>Source video</CardTitle>
                <CardDescription>Upload the clip you want edited. Uploading is free; you’re charged on the Export step.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <Field id="title" label="Title" error={!title.trim() ? 'Title is required.' : undefined}>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
                </Field>
                {busy ? (
                  <p className="text-sm text-muted-foreground">{project.sourceAsset?.originalName ?? 'Video'} — locked while rendering.</p>
                ) : (
                  <VideoUploader current={project.sourceAsset ?? null} onUploaded={(a) => attach.mutate(a)} />
                )}
                <Field id="script" label="Notes (optional)" hint={`${script.length.toLocaleString()} / 20,000`}>
                  <Textarea value={script} onChange={(e) => setScript(e.target.value)} maxLength={20000} rows={4} />
                </Field>
              </CardContent>
            </Card>
          </fieldset>
        )}

        {step === 'script' && (
          <fieldset disabled={busy} className="grid gap-6 disabled:opacity-60">
            <Card>
              <CardContent className="grid gap-5 pt-6">
                <Field id="title" label="Title" error={!title.trim() ? 'Title is required.' : undefined}>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
                </Field>
                {project.topic && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Topic:</span> {project.topic}
                  </p>
                )}
                <Field
                  id="script"
                  label="Script"
                  error={script.trim().length > 5000 ? 'One voiceover can be up to 5,000 characters (about 6 minutes).' : undefined}
                  hint={`${script.trim().length.toLocaleString()} / 5,000 characters${script.trim() ? ` · about ${Math.max(1, Math.round(script.trim().length / 13))} s of speech` : ''}`}
                >
                  <Textarea value={script} onChange={(e) => setScript(e.target.value)} maxLength={20000} rows={10} placeholder="What should the voice say?" />
                </Field>
                <ScriptAssist
                  language={custom.settings.language}
                  style={custom.style}
                  hasScript={script.trim().length > 0}
                  initialTopic={project.topic}
                  onScript={(text, aiTitle) => {
                    setScript(text);
                    if (!title.trim() && aiTitle) setTitle(aiTitle);
                  }}
                />
              </CardContent>
            </Card>
          </fieldset>
        )}

        {step === 'voice' && (
          <VoiceoverPanel
            project={project}
            settings={settings}
            onSettingsChange={(s) => setCustom({ ...custom, settings: s })}
            dirty={dirty}
            saveFirst={() => save.mutateAsync()}
            scriptLength={script.trim().length}
          />
        )}

        {step === 'scenes' && <ScenesPanel project={project} dirty={dirty} saveFirst={() => save.mutateAsync()} />}

        {step === 'presenter' && (
          <fieldset disabled={busy} className="grid gap-6 disabled:opacity-60">
            <Card>
              <CardHeader>
                <CardTitle>Presenter</CardTitle>
                <CardDescription>Optional. Without one, the video is your voiceover over the background below.</CardDescription>
              </CardHeader>
              <CardContent>
                <PresenterPicker settings={settings} onChange={setSettings} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Background</CardTitle>
                {custom.settings.avatarId && (custom.settings.avatarLayout ?? 'full') === 'full' && (
                  <CardDescription>With a full-frame presenter only the solid colour is used — pick “Cut out over the background” to use a gradient, image or video.</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <BackgroundPicker settings={settings} onChange={setSettings} asset={project.backgroundAsset} onAsset={(a) => attachBackground.mutate(a)} />
              </CardContent>
            </Card>
          </fieldset>
        )}

        {step === 'style' && project.mode === 'editor' && (
          <fieldset disabled={busy} className="grid gap-6 disabled:opacity-60">
            <Card>
              <CardContent className="grid gap-8 pt-6 lg:grid-cols-[1fr_280px]">
                <CustomizeForm value={custom} onChange={setCustom} />
                <div className="lg:sticky lg:top-24 lg:self-start">
                  <LivePreview aspect={custom.aspectRatio} settings={settings} source={project.sourceAsset} sampleText={project.captionLines?.[0]?.text} />
                </div>
              </CardContent>
            </Card>
          </fieldset>
        )}

        {step === 'style' && project.mode !== 'editor' && (
          <fieldset disabled={busy} className="grid gap-6 disabled:opacity-60">
            <Card>
              <CardContent className="grid gap-10 pt-6">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={custom.settings.disclosure !== false}
                    onChange={(e) => setSettings({ disclosure: e.target.checked })}
                  />
                  <span>
                    Show a small “AI-generated” label
                    <span className="block text-xs text-muted-foreground">Recommended, and many platforms ask for AI disclosure. Always shown with a talking presenter or a cloned voice.</span>
                  </span>
                </label>
                {project.mode === 'faceless' && custom.settings.facelessStyle === 'motion' && (
                  <section className="grid gap-4 lg:grid-cols-[1fr_260px]">
                    <div className="grid content-start gap-3">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Colour theme</h3>
                      <p className="text-xs text-muted-foreground">
                        Light or dark. Every scene also gets its own background, a different transition (zoom, swing, split, cube, diamond…), animated emoji and word-by-word captions.
                      </p>
                      <MotionThemePicker value={custom.settings.motionTheme} onChange={(v) => setSettings({ motionTheme: v })} />
                    </div>
                    {(project.scenes?.length ?? 0) > 0 && (
                      <Suspense fallback={<div className="mx-auto aspect-[9/16] w-full max-w-[260px] rounded-lg bg-muted" />}>
                        <MotionPreview scenes={project.scenes!} aspect={custom.aspectRatio} language={custom.settings.language} themeId={custom.settings.motionTheme} seedKey={project.id} />
                      </Suspense>
                    )}
                  </section>
                )}
                {project.mode === 'faceless' && (
                  <section className="grid gap-4 sm:grid-cols-2">
                    {(custom.settings.facelessStyle ?? 'stock') === 'stock' && (
                      <Field id="scene-transition" label="Scene transitions" hint="How one clip changes to the next. Mix uses a different effect at every cut.">
                        <Select value={custom.settings.sceneTransition ?? 'mix'} onChange={(e) => setSettings({ sceneTransition: e.target.value as ProjectSettings['sceneTransition'] })}>
                          <option value="mix">Mix (different at every cut)</option>
                          <option value="smooth">Smooth push</option>
                          <option value="zoom">Zoom in</option>
                          <option value="circle">Circle reveal</option>
                          <option value="blur">Motion blur</option>
                          <option value="pixel">Pixelate</option>
                          <option value="fade">Fade</option>
                          <option value="slide">Slide</option>
                          <option value="wipe">Wipe</option>
                          <option value="cut">Cut (no transition)</option>
                        </Select>
                      </Field>
                    )}
                    <label className="flex items-start gap-2 self-end text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                        checked={custom.settings.soundEffects !== false}
                        onChange={(e) => setSettings({ soundEffects: e.target.checked })}
                      />
                      <span>
                        Sound effects
                        <span className="block text-xs text-muted-foreground">
                          {(custom.settings.facelessStyle ?? 'stock') === 'motion'
                            ? 'Soft pops, ticks, typing and a bell timed to the animations, plus a whoosh between scenes.'
                            : 'A soft whoosh at each scene change (not with Cut).'}{' '}
                          Kept quiet under your voice.
                        </span>
                      </span>
                    </label>
                  </section>
                )}
                <CustomizeForm value={custom} onChange={setCustom} mode={project.mode} />
              </CardContent>
            </Card>
          </fieldset>
        )}

        {step === 'export' && (
          <>
            <RenderPanel project={project} dirty={dirty} onStep={(s) => go(s)} />
            {project.status === 'completed' && (project.captionLines?.length ?? 0) > 0 && <CaptionEditor project={project} />}
          </>
        )}
      </div>

      {/* Back / Continue */}
      <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-6">
        {prev ? (
          <Button variant="ghost" onClick={() => go(prev.id)} disabled={save.isPending}>
            <ArrowLeft /> {prev.label}
          </Button>
        ) : (
          <span />
        )}
        {next && (
          <div className="flex flex-col items-end gap-1">
            <Button variant="gradient" onClick={() => go(next.id)} loading={save.isPending} disabled={Boolean(blocker) || busy || !title.trim()}>
              {dirty ? 'Save & continue' : 'Continue'}: {next.label} <ArrowRight />
            </Button>
            {blocker && !busy && <p className="text-xs text-muted-foreground">{blocker}</p>}
          </div>
        )}
      </div>

    </div>
  );
}
