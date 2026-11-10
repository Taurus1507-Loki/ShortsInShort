import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { CustomizeForm, DEFAULT_SETTINGS, StatusBadge, type CustomizeValue } from '@/components/app/projects';
import { CaptionEditor } from '@/components/app/CaptionEditor';
import { LivePreview } from '@/components/app/LivePreview';
import { RenderPanel } from '@/components/app/RenderPanel';
import { VoiceoverPanel } from '@/components/app/VoiceoverPanel';
import { BackgroundPicker, PresenterPicker, ScriptAssist } from '@/components/app/AvatarControls';
import { VideoUploader } from '@/components/app/VideoUploader';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Skeleton } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/overlays';
import { keys, queryClient, useProjectLive } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { modeName } from '@/config/options';
import { timeAgo } from '@/lib/utils';
import type { Asset, Project } from '@/types/api';

export default function ProjectDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: project, isLoading, isError, error } = useProjectLive(id);

  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  const [custom, setCustom] = useState<CustomizeValue | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const autoGenerate = params.get('generate') === '1';

  // Sync the form from the server, but don't clobber unsaved edits during status polling.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!project) return;
    const stamp = `${project.id}:${project.updatedAt}`;
    if (loadedFor === null || (loadedFor !== stamp && !isDirty())) {
      setTitle(project.title);
      setScript(project.script);
      setCustom({ style: project.style, aspectRatio: project.aspectRatio, settings: project.settings });
      setLoadedFor(stamp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const isDirty = () =>
    !!project &&
    !!custom &&
    (title !== project.title ||
      script !== project.script ||
      JSON.stringify(custom) !== JSON.stringify({ style: project.style, aspectRatio: project.aspectRatio, settings: project.settings }));

  const onSaved = (p: Project) => {
    queryClient.setQueryData(keys.project(id), p);
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: keys.dashboard });
    queryClient.invalidateQueries({ queryKey: keys.estimate(id) });
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
      setLoadedFor(`${p.id}:${p.updatedAt}`);
      toast.success('Changes saved');
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

  const remove = useMutation({
    mutationFn: () => api(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: keys.dashboard });
      toast.success('Project deleted');
      navigate('/app/projects', { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  useEffect(() => {
    // Consume the one-shot ?generate=1 flag so a refresh doesn't reopen the dialog.
    if (autoGenerate) {
      const t = setTimeout(() => setParams({}, { replace: true }), 500);
      return () => clearTimeout(t);
    }
  }, [autoGenerate, setParams]);

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

  const busy = project.status === 'queued' || project.status === 'processing';
  const dirty = isDirty();

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/app/projects" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Projects
      </Link>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-extrabold sm:text-3xl">{project.title}</h1>
            <StatusBadge status={project.status} />
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {modeName(project.mode)} · created {timeAgo(project.createdAt)} · last edited {timeAgo(project.updatedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(true)} disabled={busy}>
            <Trash2 /> Delete
          </Button>
          <Button variant="gradient" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || !title.trim() || busy}>
            <Save /> Save
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {project.mode === 'editor' && (
          <Card>
            <CardHeader>
              <CardTitle>Source video</CardTitle>
              <CardDescription>The raw footage the AI editor works from.</CardDescription>
            </CardHeader>
            <CardContent>
              {busy ? (
                <p className="text-sm text-muted-foreground">{project.sourceAsset?.originalName ?? 'Video'} — locked while rendering.</p>
              ) : (
                <VideoUploader current={project.sourceAsset ?? null} onUploaded={(a) => attach.mutate(a)} />
              )}
            </CardContent>
          </Card>
        )}

        {project.mode !== 'avatar' && <RenderPanel project={project} autoOpen={autoGenerate} dirty={dirty} />}

        {project.mode !== 'avatar' && project.status === 'completed' && (project.captionLines?.length ?? 0) > 0 && <CaptionEditor project={project} />}

        <fieldset disabled={busy} className="grid gap-6 disabled:opacity-60">
          <Card>
            <CardHeader>
              <CardTitle>Content</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              <Field id="title" label="Title" error={!title.trim() ? 'Title is required.' : undefined}>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
              </Field>
              {project.topic && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Topic:</span> {project.topic}
                </p>
              )}
              {project.mode === 'avatar' ? (
                <Field
                  id="script"
                  label="Script"
                  error={script.trim().length > 5000 ? 'One voiceover can be up to 5,000 characters (about 6 minutes).' : undefined}
                  hint={`${script.trim().length.toLocaleString()} / 5,000 characters · what the voice will say, word for word`}
                >
                  <Textarea value={script} onChange={(e) => setScript(e.target.value)} maxLength={20000} rows={8} placeholder="What should your presenter say?" />
                </Field>
              ) : null}
              {project.mode === 'avatar' ? (
                <ScriptAssist
                  language={custom.settings.language}
                  style={custom.style}
                  hasScript={script.trim().length > 0}
                  onScript={(text, aiTitle) => {
                    setScript(text);
                    if (!title.trim() && aiTitle) setTitle(aiTitle);
                  }}
                />
              ) : (
                <Field id="script" label="Script / notes" hint={`${script.length.toLocaleString()} / 20,000`}>
                  <Textarea value={script} onChange={(e) => setScript(e.target.value)} maxLength={20000} rows={6} />
                </Field>
              )}
            </CardContent>
          </Card>
          {project.mode !== 'avatar' && (
          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>Each setting says what it changes and whether it applies today. The preview updates as you edit.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-8 lg:grid-cols-[1fr_280px]">
              <CustomizeForm value={custom} onChange={setCustom} />
              <div className="lg:sticky lg:top-24 lg:self-start">
                <LivePreview aspect={custom.aspectRatio} settings={{ ...DEFAULT_SETTINGS, ...custom.settings }} source={project.sourceAsset} sampleText={project.captionLines?.[0]?.text} />
              </div>
            </CardContent>
          </Card>
          )}
        </fieldset>
        {project.mode === 'avatar' && (
          <VoiceoverPanel
            project={project}
            settings={{ ...DEFAULT_SETTINGS, ...custom.settings }}
            onSettingsChange={(settings) => setCustom({ ...custom, settings })}
            dirty={dirty}
            saveFirst={() => save.mutateAsync()}
            scriptLength={script.trim().length}
          />
        )}
        {project.mode === 'avatar' && (
          <fieldset disabled={busy} className="grid gap-6 disabled:opacity-60">
            <Card>
              <CardHeader>
                <CardTitle>Video settings</CardTitle>
                <CardDescription>Background, captions and branding for the finished video. Click Save before making the video.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-10">
                <section className="grid gap-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Presenter</h3>
                  <PresenterPicker
                    settings={{ ...DEFAULT_SETTINGS, ...custom.settings }}
                    onChange={(patch) => setCustom({ ...custom, settings: { ...custom.settings, ...patch } })}
                  />
                </section>
                <section className="grid gap-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Background</h3>
                  {custom.settings.avatarId && (custom.settings.avatarLayout ?? 'full') === 'full' && (
                    <p className="text-xs text-muted-foreground">With a full-frame presenter only the solid colour is used — pick “Cut out over the background” to use a gradient, image or video.</p>
                  )}
                  <BackgroundPicker
                    settings={{ ...DEFAULT_SETTINGS, ...custom.settings }}
                    onChange={(patch) => setCustom({ ...custom, settings: { ...custom.settings, ...patch } })}
                    asset={project.backgroundAsset}
                    onAsset={(a) => attachBackground.mutate(a)}
                  />
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                      checked={custom.settings.disclosure !== false}
                      onChange={(e) => setCustom({ ...custom, settings: { ...custom.settings, disclosure: e.target.checked } })}
                    />
                    <span>
                      Show a small “AI-generated” label
                      <span className="block text-xs text-muted-foreground">Recommended, and many platforms ask for AI disclosure. Always shown with a talking presenter or a cloned voice.</span>
                    </span>
                  </label>
                </section>
                <CustomizeForm value={custom} onChange={setCustom} mode="avatar" />
              </CardContent>
            </Card>
          </fieldset>
        )}
        {project.mode === 'avatar' && <RenderPanel project={project} autoOpen={false} dirty={dirty} />}
        {project.mode === 'avatar' && project.status === 'completed' && (project.captionLines?.length ?? 0) > 0 && <CaptionEditor project={project} />}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">Delete “{project.title}”?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">The project will be removed from your workspace. Uploaded and rendered videos stay in your Media Library.</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete project
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
