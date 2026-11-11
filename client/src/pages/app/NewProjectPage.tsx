import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, Lock, Save, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { CustomizeForm, DEFAULT_SETTINGS, type CustomizeValue } from '@/components/app/projects';
import { VideoUploader } from '@/components/app/VideoUploader';
import { LivePreview } from '@/components/app/LivePreview';
import { VoicePicker } from '@/components/app/VoicePicker';
import { ScriptAssist } from '@/components/app/AvatarControls';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Card, Field, Notice } from '@/components/ui/primitives';
import { useAuth } from '@/features/auth/AuthProvider';
import { MODES, modeName, styleName, LANGUAGES } from '@/config/options';
import { api, ApiError, errorMessage } from '@/lib/api';
import { queryClient, useBrandKit, useMeta, useVoices } from '@/lib/queries';
import { cn } from '@/lib/utils';
import type { Asset, Project, ProjectMode, ProjectSettings } from '@/types/api';

const STEPS = ['Choose mode', 'Content', 'Customize', 'Review & generate', 'Preview & export'];
/** Step 5 (preview/export) happens on the project page once rendering finishes. */
const AVAILABLE_STEPS = 3;
const RES_RANK = { '720p': 1, '1080p': 2, '4k': 3 } as const;

/**
 * The sidebar links (AI Video Editor / AI Avatar) only change `?mode=`, which keeps this page mounted.
 * Keying the wizard by mode starts it fresh for the newly chosen mode instead of keeping the old one.
 */
export default function NewProjectPage() {
  const [params] = useSearchParams();
  return <NewProjectWizard key={params.get('mode') ?? 'choose'} />;
}

function NewProjectWizard() {
  const [params] = useSearchParams();
  const initialMode = MODES.some((m) => m.id === params.get('mode')) ? (params.get('mode') as ProjectMode) : null;
  const navigate = useNavigate();
  const { user, workspace } = useAuth();
  const { data: meta } = useMeta();
  const planMax = (meta?.plans.find((p) => p.id === workspace?.plan)?.maxResolution ?? '720p') as ProjectSettings['resolution'];
  const [sourceAsset, setSourceAsset] = useState<Asset | null>(null);

  const [step, setStep] = useState(initialMode ? 1 : 0);
  const [mode, setMode] = useState<ProjectMode | null>(initialMode);
  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  const [topic, setTopic] = useState('');
  const [titleError, setTitleError] = useState<string>();
  const [custom, setCustom] = useState<CustomizeValue>({ style: 'viral', aspectRatio: '9:16', settings: DEFAULT_SETTINGS });
  // Apply Brand Kit caption defaults once, when the kit says so (the user can still change them).
  const { data: brandKit } = useBrandKit();
  const voicedMode = mode === 'avatar' || mode === 'faceless';
  const { data: voices } = useVoices(voicedMode && Boolean(meta?.features.voices));
  const [brandApplied, setBrandApplied] = useState(false);
  useEffect(() => {
    if (brandApplied || !brandKit) return;
    setBrandApplied(true);
    if (!brandKit.applyToNewProjects) return;
    setCustom((c) => ({
      ...c,
      settings: { ...c.settings, captionStyle: brandKit.captionStyle, captionPosition: brandKit.captionPosition, captionSize: brandKit.captionSize, highlightColor: brandKit.highlightColor },
    }));
  }, [brandKit, brandApplied]);

  // Default the export resolution to what the plan allows (Free = 720p) so generation isn't blocked.
  const [resTouched, setResTouched] = useState(false);
  const effectiveCustom: CustomizeValue = resTouched
    ? custom
    : { ...custom, settings: { ...custom.settings, resolution: RES_RANK[planMax] < RES_RANK[custom.settings.resolution] ? planMax : custom.settings.resolution } };

  const save = useMutation({
    mutationFn: (_opts: { generate: boolean }) =>
      api<{ data: Project }>('/projects', {
        method: 'POST',
        body: {
          title: title.trim(),
          mode,
          script,
          topic: topic.trim(),
          style: effectiveCustom.style,
          aspectRatio: effectiveCustom.aspectRatio,
          settings: effectiveCustom.settings,
          ...(mode === 'editor' && sourceAsset ? { sourceAssetId: sourceAsset.id } : {}),
        },
      }).then((r) => r.data),
    onSuccess: (p, { generate }) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      if (!generate) toast.success('Draft saved');
      navigate(`/app/projects/${p.id}${generate ? '?generate=1' : ''}`);
    },
  });

  const next = () => {
    if (step === 1) {
      if (!title.trim()) {
        setTitleError('Give your project a title.');
        return;
      }
      setTitleError(undefined);
    }
    setStep((s) => Math.min(s + 1, AVAILABLE_STEPS));
  };

  const modeInfo = MODES.find((m) => m.id === mode);
  const unverified = user && !user.emailVerified;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Create video" description="Set up your project. You can change any of this later." />

      {/* Stepper */}
      <ol className="mb-8 grid grid-cols-5 gap-2" aria-label="Progress">
        {STEPS.map((label, i) => {
          const locked = i > AVAILABLE_STEPS;
          const done = i < step;
          const current = i === step;
          return (
            <li key={label} className="min-w-0">
              <div className={cn('h-1.5 rounded-full', done || current ? 'bg-brand-gradient' : 'bg-muted')} />
              <p className={cn('mt-2 flex items-center gap-1 truncate text-xs font-medium', current ? 'text-foreground' : 'text-muted-foreground')} aria-current={current ? 'step' : undefined}>
                {done ? <Check className="h-3 w-3 text-success" /> : locked ? <Lock className="h-3 w-3" /> : null}
                <span className="truncate">{label}</span>
              </p>
            </li>
          );
        })}
      </ol>

      <Card className="p-5 sm:p-8">
        {step === 0 && (
          <div className="grid gap-4">
            <h2 className="text-lg font-bold">What do you want to make?</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={mode === m.id}
                  onClick={() => {
                    setMode(m.id);
                    setStep(1);
                  }}
                  className={cn('flex flex-col rounded-xl border p-5 text-left transition-colors', mode === m.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40')}
                >
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-gradient text-white">
                    <m.icon className="h-5 w-5" />
                  </span>
                  <span className="mt-4 font-semibold">{m.name}</span>
                  <span className="mt-1 text-sm text-muted-foreground">{m.description}</span>
                  <span className="mt-3 text-xs text-muted-foreground">{m.id === 'editor' ? 'Available now · core edit' : m.id === 'avatar' ? 'Available now · script → voice → video' : 'Available now · topic → stock-footage video'}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && modeInfo && (
          <div className="grid gap-6">
            <h2 className="text-lg font-bold">{modeInfo.name}: content</h2>
            <Field id="title" label="Project title" error={titleError}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. 3 habits that doubled my reach" autoFocus />
            </Field>

            {mode === 'editor' && (
              <div className="grid gap-2">
                <span className="text-sm font-medium">Footage</span>
                {unverified ? (
                  <Notice tone="warning">Verify your email address to upload videos.</Notice>
                ) : (
                  <VideoUploader current={sourceAsset} onUploaded={setSourceAsset} />
                )}
              </div>
            )}

            {mode === 'faceless' && (
              <Field id="topic" label="Topic" hint="What the video is about — used when AI writes your script and picks footage.">
                <Input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} placeholder="e.g. Why compounding is the 8th wonder of the world" />
              </Field>
            )}

            <Field
              id="script"
              label={mode === 'editor' ? 'Notes or script (optional)' : 'Script'}
              error={voicedMode && script.trim().length > 5000 ? 'One voiceover can be up to 5,000 characters (about 6 minutes).' : undefined}
              hint={voicedMode ? `${script.trim().length.toLocaleString()} / 5,000 characters · what the voice will say, word for word` : `${script.length.toLocaleString()} / 20,000 characters`}
            >
              <Textarea value={script} onChange={(e) => setScript(e.target.value)} maxLength={20000} rows={8} placeholder={mode === 'avatar' ? 'What should your avatar say?' : 'Write or paste your script…'} />
            </Field>
            {voicedMode && (
              <ScriptAssist
                language={custom.settings.language}
                style={custom.style}
                hasScript={script.trim().length > 0}
                initialTopic={topic || title}
                onScript={(text, aiTitle) => {
                  setScript(text);
                  if (!title.trim() && aiTitle) setTitle(aiTitle);
                }}
              />
            )}
          </div>
        )}

        {step === 2 && voicedMode && (
          <div className="grid gap-6">
            <h2 className="text-lg font-bold">Voice</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="language" label="Spoken language" hint="The language your script is written in.">
                <Select value={custom.settings.language} onChange={(e) => setCustom({ ...custom, settings: { ...custom.settings, language: e.target.value as ProjectSettings['language'] } })}>
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="rate" label="Speaking speed" hint="How fast the voice talks. Normal suits most shorts.">
                <Select value={String(custom.settings.speakingRate)} onChange={(e) => setCustom({ ...custom, settings: { ...custom.settings, speakingRate: Number(e.target.value) } })}>
                  <option value="0.85">Slower (0.85×)</option>
                  <option value="1">Normal (1×)</option>
                  <option value="1.1">Faster (1.1×)</option>
                  <option value="1.2">Fastest (1.2×)</option>
                </Select>
              </Field>
            </div>
            <VoicePicker language={custom.settings.language} value={custom.settings.voiceId} onChange={(v) => setCustom({ ...custom, settings: { ...custom.settings, voiceId: v.id } })} />
          </div>
        )}

        {step === 2 && !voicedMode && (
          <div className="grid gap-6">
            <h2 className="text-lg font-bold">Customize</h2>
            <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
              <CustomizeForm
                value={effectiveCustom}
                onChange={(v) => {
                  if (v.settings.resolution !== effectiveCustom.settings.resolution) setResTouched(true);
                  setCustom(v);
                }}
              />
              <div className="lg:sticky lg:top-24 lg:self-start">
                <LivePreview aspect={effectiveCustom.aspectRatio} settings={effectiveCustom.settings} source={sourceAsset} sampleText={title || undefined} />
              </div>
            </div>
            {RES_RANK[effectiveCustom.settings.resolution] > RES_RANK[planMax] && (
              <Notice tone="warning">Your plan exports up to {planMax}. You can save this draft, but you’ll need to lower the resolution or upgrade to render it.</Notice>
            )}
          </div>
        )}

        {step === 3 && mode && (
          <div className="grid gap-6">
            <h2 className="text-lg font-bold">Review & generate</h2>
            <dl className="grid gap-x-8 gap-y-3 rounded-xl bg-muted/40 p-5 text-sm sm:grid-cols-2">
              {(voicedMode
                ? [
                    ['Mode', modeName(mode)],
                    ['Title', title],
                    ['Spoken language', LANGUAGES.find((l) => l.id === effectiveCustom.settings.language)?.name],
                    ['Voice', voices?.find((v) => v.id === effectiveCustom.settings.voiceId)?.name ?? (effectiveCustom.settings.voiceId ? 'Selected' : 'Not chosen yet')],
                    ['Speaking speed', `${effectiveCustom.settings.speakingRate}×`],
                    ['Script', `${script.trim().length.toLocaleString()} characters`],
                  ]
                : [
                ['Mode', modeName(mode)],
                ['Title', title],
                ['Style', styleName(effectiveCustom.style)],
                ['Format', effectiveCustom.aspectRatio],
                ['Spoken language', LANGUAGES.find((l) => l.id === effectiveCustom.settings.language)?.name],
                ['Caption language', effectiveCustom.settings.captionLanguage && effectiveCustom.settings.captionLanguage !== 'same' ? LANGUAGES.find((l) => l.id === effectiveCustom.settings.captionLanguage)?.name : 'Same as spoken'],
                ['Background', { auto: 'Auto', crop: 'Fill frame', blur: 'Blurred background' }[effectiveCustom.settings.framing ?? 'auto']],
                ['Resolution', effectiveCustom.settings.resolution],
                ['Footage', mode === 'editor' ? (sourceAsset?.originalName ?? 'Not uploaded yet') : '—'],
                ['Captions', effectiveCustom.settings.captionsEnabled ? (meta?.features.captions ? 'On' : 'On (needs transcription key)') : 'Off'],
              ]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-border/60 pb-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            {mode === 'faceless' ? (
              <Notice tone="info" title="What happens next">
                After creating the project: generate the voiceover (1 credit per started 400 characters), let AI plan the scenes with licensed stock clips (free), swap any clip you don’t like, then make the video (1 credit per started 30 s).
              </Notice>
            ) : mode === 'avatar' ? (
              <Notice tone="info" title="What you can make today">
                After creating the project you can generate the AI voiceover (you’ll see the credit cost first — 1 credit per started 400 characters). Then choose a background and, optionally, a talking presenter, and make the video.
              </Notice>
            ) : mode === 'editor' ? (
              <Notice tone="info" title="What this render does today">
                {meta?.features.captions ? 'Removes pauses and filler words, adds animated captions, reframes' : 'Removes pauses, reframes'} to {effectiveCustom.aspectRatio}, balances loudness and exports an MP4. {meta?.features.captions ? 'B-roll and music are coming next.' : 'Captions, B-roll and music are coming next.'} You’ll see the exact credit cost before anything is charged.
              </Notice>
            ) : (
              <Notice tone="info" title={`${modeName(mode)} generation isn’t available yet`}>
                Your project will be saved as a draft with these settings and can be generated once this mode launches.
              </Notice>
            )}
            {unverified && <Notice tone="warning">Verify your email address to save projects. Check your inbox for the link.</Notice>}
            {save.isError && (
              <Notice tone="error">{save.error instanceof ApiError && save.error.code === 'EMAIL_NOT_VERIFIED' ? 'Please verify your email first.' : errorMessage(save.error)}</Notice>
            )}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-6">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            <ArrowLeft /> Back
          </Button>
          {step < AVAILABLE_STEPS ? (
            <Button onClick={next} disabled={step === 0 && !mode}>
              Continue <ArrowRight />
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => save.mutate({ generate: false })} loading={save.isPending && !save.variables?.generate} disabled={Boolean(unverified) || save.isPending}>
                <Save /> Save draft
              </Button>
              <Button
                variant="gradient"
                onClick={() => save.mutate({ generate: mode === 'editor' })}
                loading={save.isPending && (voicedMode || save.variables?.generate)}
                disabled={Boolean(unverified) || save.isPending || (mode === 'editor' && !sourceAsset) || (voicedMode && script.trim().length > 5000)}
                title={mode === 'editor' && !sourceAsset ? 'Upload a video first' : undefined}
              >
                <Sparkles /> {voicedMode ? 'Create & add voiceover' : 'Create & generate'}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
