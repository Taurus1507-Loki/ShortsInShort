import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Coins } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { DEFAULT_SETTINGS, type CustomizeValue } from '@/components/app/projects';
import { VideoUploader } from '@/components/app/VideoUploader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, Field, Notice } from '@/components/ui/primitives';
import { useAuth } from '@/features/auth/AuthProvider';
import { ASPECTS, MODES } from '@/config/options';
import { api, ApiError, errorMessage } from '@/lib/api';
import { queryClient, useBrandKit, useMeta } from '@/lib/queries';
import { cn } from '@/lib/utils';
import type { Asset, Project, ProjectMode, ProjectSettings } from '@/types/api';
import { useTemplates } from '@/features/templates';
import { FLOWS, stepPrice, stepsFor } from '@/features/studio';

const RES_RANK = { '720p': 1, '1080p': 2, '4k': 3 } as const;

/** What each mode is for, in one line. */
const MOTTO: Record<ProjectMode, string> = {
  editor: 'Your footage, edited for you.',
  avatar: 'A presenter and voice, no camera needed.',
  faceless: 'A whole video from just an idea.',
};

/**
 * Creating a video, page 1 of the flow: pick a mode (/app/new), then the basics (/app/new?mode=…).
 * Creating the project opens its first step page; each later step is its own page with its own price.
 */
export default function NewProjectPage() {
  const [params] = useSearchParams();
  const mode = MODES.some((m) => m.id === params.get('mode')) ? (params.get('mode') as ProjectMode) : null;
  // Keyed by mode so switching modes from the sidebar starts fresh.
  return mode ? <Basics key={mode} mode={mode} /> : <ChooseMode />;
}

function ChooseMode() {
  const { data: meta } = useMeta();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Create video" description="Pick what you want to make. Each step is its own page, and you only pay for the steps that cost money." />
      <div className="grid gap-4 md:grid-cols-3">
        {MODES.map((m) => (
          <Link
            key={m.id}
            to={`/app/new?mode=${m.id}`}
            className="flex flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-gradient text-white">
              <m.icon className="h-5 w-5" />
            </span>
            <span className="mt-4 font-semibold">{m.name}</span>
            <span className="mt-0.5 text-sm font-medium text-highlight">{MOTTO[m.id]}</span>
            <span className="mt-2 text-sm text-muted-foreground">{m.description}</span>
            <FlowPreview mode={m.id} className="mt-4" meta={meta} compact />
          </Link>
        ))}
      </div>
    </div>
  );
}

/** The steps a mode goes through, with what each costs. */
function FlowPreview({ mode, meta, settings, className, compact }: { mode: ProjectMode; meta: ReturnType<typeof useMeta>['data']; settings?: ProjectSettings; className?: string; compact?: boolean }) {
  const steps = stepsFor(mode);
  return (
    <ol className={cn('grid gap-1.5 text-xs', className)}>
      {steps.map((s, i) => {
        const price = stepPrice(meta, { mode, settings: settings ?? DEFAULT_SETTINGS }, s.id);
        return (
          <li key={s.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-2.5 py-1.5">
            <span className="flex items-center gap-2">
              <span className="grid h-4 w-4 place-items-center rounded-full bg-muted text-[10px] font-semibold">{i + 1}</span>
              <span className="font-medium">{s.label}</span>
              {!compact && <span className="hidden text-muted-foreground sm:inline">— {s.blurb}</span>}
            </span>
            <span className={cn('shrink-0', price.free ? 'text-success' : 'text-muted-foreground')}>{price.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Basics({ mode }: { mode: ProjectMode }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, workspace } = useAuth();
  const { data: meta } = useMeta();
  const planMax = (meta?.plans.find((p) => p.id === workspace?.plan)?.maxResolution ?? '720p') as ProjectSettings['resolution'];
  const modeInfo = MODES.find((m) => m.id === mode)!;
  const voiced = mode !== 'editor';

  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [script, setScript] = useState('');
  const [titleError, setTitleError] = useState<string>();
  const [sourceAsset, setSourceAsset] = useState<Asset | null>(null);
  const [custom, setCustom] = useState<CustomizeValue>({ style: 'viral', aspectRatio: '9:16', settings: DEFAULT_SETTINGS });

  // Brand Kit caption defaults, once (they stay editable on the Style step).
  const { data: brandKit, isError: brandKitFailed } = useBrandKit();
  const [brandApplied, setBrandApplied] = useState(false);
  useEffect(() => {
    if (brandApplied || !brandKit) return;
    setBrandApplied(true);
    if (!brandKit.applyToNewProjects) return;
    setCustom((c) => ({ ...c, settings: { ...c.settings, captionStyle: brandKit.captionStyle, captionPosition: brandKit.captionPosition, captionSize: brandKit.captionSize, highlightColor: brandKit.highlightColor } }));
  }, [brandKit, brandApplied]);

  // Starting from a template (/app/new?mode=…&template=…): pre-fill once, after the Brand Kit so the
  // template's own caption choices win.
  const templateId = params.get('template');
  const { data: templates } = useTemplates(Boolean(templateId));
  const template = templates?.find((t) => t.id === templateId && t.mode === mode) ?? null;
  const [templateApplied, setTemplateApplied] = useState(false);
  useEffect(() => {
    if (templateApplied || !template || !(brandApplied || brandKitFailed)) return;
    setTemplateApplied(true);
    setTitle((v) => v || template.title);
    if (template.mode !== 'editor') setScript((v) => v || template.script);
    if (template.mode === 'faceless') setTopic((v) => v || template.topic);
    setCustom((c) => ({ style: template.style, aspectRatio: template.aspectRatio, settings: { ...c.settings, ...template.settings } }));
  }, [template, templateApplied, brandApplied, brandKitFailed]);

  // Export at what the plan allows (Free = 720p) so the Export step isn't blocked.
  const settings: ProjectSettings = {
    ...custom.settings,
    resolution: RES_RANK[planMax] < RES_RANK[custom.settings.resolution] ? planMax : custom.settings.resolution,
  };
  const setSettings = (patch: Partial<ProjectSettings>) => setCustom((c) => ({ ...c, settings: { ...c.settings, ...patch } }));

  const create = useMutation({
    mutationFn: () =>
      api<{ data: Project }>('/projects', {
        method: 'POST',
        body: {
          title: title.trim(),
          mode,
          script,
          topic: topic.trim(),
          style: custom.style,
          aspectRatio: custom.aspectRatio,
          settings,
          ...(mode === 'editor' && sourceAsset ? { sourceAssetId: sourceAsset.id } : {}),
        },
      }).then((r) => r.data),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Project created');
      // Footage already uploaded → straight to Style; otherwise the first step.
      const first = mode === 'editor' && sourceAsset ? 'style' : FLOWS[mode][0];
      navigate(`/app/projects/${p.id}/${first}`);
    },
  });

  const submit = () => {
    if (!title.trim()) return setTitleError('Give your project a title.');
    setTitleError(undefined);
    create.mutate();
  };
  const unverified = user && !user.emailVerified;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/app/new" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All video types
      </Link>
      <PageHeader title={modeInfo.name} description={MOTTO[mode]} />

      <Card className="grid gap-6 p-5 sm:p-8">
        {template && (
          <Notice tone="info" title={`Using the “${template.name}” template`}>
            {template.mode === 'editor' ? template.script : 'The title, script and settings are filled in from the template. You can change all of it on the next pages.'}
          </Notice>
        )}
        <Field id="title" label="Project title" error={titleError}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. 3 habits that doubled my reach" autoFocus />
        </Field>

        {mode === 'faceless' && (
          <>
            <Field id="topic" label="Topic" hint="What the video is about. AI uses it to write your script and pick footage.">
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} placeholder="e.g. Why compounding is the 8th wonder of the world" />
            </Field>
            <div className="grid gap-2">
              <span className="text-sm font-medium">Visuals</span>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Visuals">
                {([
                  ['stock', 'Stock footage', 'Real licensed video clips for each scene'],
                  ['motion', 'Animated (Motion Explainer)', 'Cards, icons, numbers and diagrams in your brand colours'],
                ] as const).map(([id, name, sub]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={(settings.facelessStyle ?? 'stock') === id}
                    onClick={() => setSettings({ facelessStyle: id })}
                    className={cn('rounded-lg border p-3 text-left text-sm', (settings.facelessStyle ?? 'stock') === id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40')}
                  >
                    <span className="block font-semibold">{name}</span>
                    <span className="text-xs text-muted-foreground">{sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {mode === 'editor' && (
          <div className="grid gap-2">
            <span className="text-sm font-medium">Footage (you can also add it on the next page)</span>
            {unverified ? <Notice tone="warning">Verify your email address to upload videos.</Notice> : <VideoUploader current={sourceAsset} onUploaded={setSourceAsset} />}
          </div>
        )}

        <div className="grid gap-2">
          <span className="text-sm font-medium">Format</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Format">
            {ASPECTS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={custom.aspectRatio === a.id}
                onClick={() => setCustom((c) => ({ ...c, aspectRatio: a.id }))}
                className={cn('rounded-lg border p-3 text-left text-sm', custom.aspectRatio === a.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40')}
              >
                <span className="block font-semibold">{a.name}</span>
                <span className="text-xs text-muted-foreground">{a.platforms}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2 rounded-xl border border-border p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Coins className="h-4 w-4 text-highlight" /> What happens next
          </p>
          <p className="text-xs text-muted-foreground">
            Each step is its own page. {voiced ? 'Writing the script and planning scenes are free;' : 'Uploading and styling are free;'} you’re charged only when a step that costs money runs, and you see the price first. Redoing a step only charges that step.
          </p>
          <FlowPreview mode={mode} meta={meta} settings={settings} />
          {workspace && <p className="text-right text-xs text-muted-foreground">You have {workspace.creditBalance.toLocaleString()} credits.</p>}
        </div>

        {unverified && <Notice tone="warning">Verify your email address to create projects. Check your inbox for the link.</Notice>}
        {create.isError && <Notice tone="error">{create.error instanceof ApiError && create.error.code === 'EMAIL_NOT_VERIFIED' ? 'Please verify your email first.' : errorMessage(create.error)}</Notice>}

        <div className="flex justify-end border-t border-border pt-6">
          <Button variant="gradient" onClick={submit} loading={create.isPending} disabled={Boolean(unverified)}>
            Create project: {stepsFor(mode)[mode === 'editor' && sourceAsset ? 1 : 0]!.label} <ArrowRight />
          </Button>
        </div>
      </Card>
    </div>
  );
}
