import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, Lock, Save, UploadCloud } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { CustomizeForm, DEFAULT_SETTINGS, type CustomizeValue } from '@/components/app/projects';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Card, Field, Notice } from '@/components/ui/primitives';
import { useAuth } from '@/features/auth/AuthProvider';
import { MODES, modeName, styleName, LANGUAGES } from '@/config/options';
import { api, ApiError, errorMessage } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import { cn } from '@/lib/utils';
import type { Project, ProjectMode } from '@/types/api';

const STEPS = ['Choose mode', 'Content', 'Customize', 'Generate', 'Preview & export'];
/** Steps 4–5 need the rendering pipeline (Phase 2). */
const AVAILABLE_STEPS = 3;

export default function NewProjectPage() {
  const [params] = useSearchParams();
  const initialMode = MODES.some((m) => m.id === params.get('mode')) ? (params.get('mode') as ProjectMode) : null;
  const navigate = useNavigate();
  const { user } = useAuth();

  const [step, setStep] = useState(initialMode ? 1 : 0);
  const [mode, setMode] = useState<ProjectMode | null>(initialMode);
  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  const [topic, setTopic] = useState('');
  const [titleError, setTitleError] = useState<string>();
  const [custom, setCustom] = useState<CustomizeValue>({ style: 'viral', aspectRatio: '9:16', settings: DEFAULT_SETTINGS });

  const save = useMutation({
    mutationFn: () =>
      api<{ data: Project }>('/projects', {
        method: 'POST',
        body: { title: title.trim(), mode, script, topic: topic.trim(), style: custom.style, aspectRatio: custom.aspectRatio, settings: custom.settings },
      }).then((r) => r.data),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Draft saved');
      navigate(`/app/projects/${p.id}`);
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
                  <span className="mt-3 text-xs text-muted-foreground">Generation available from Phase {m.phase}</span>
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
                <div className="grid place-items-center rounded-xl border-2 border-dashed border-border px-6 py-10 text-center">
                  <UploadCloud className="h-8 w-8 text-muted-foreground" />
                  <p className="mt-3 text-sm font-semibold">Video upload arrives in the next release</p>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">Save this project as a draft now; you’ll be able to upload footage to it once secure cloud uploads are enabled.</p>
                </div>
              </div>
            )}

            {mode === 'faceless' && (
              <Field id="topic" label="Topic" hint="One line is enough — AI script planning arrives in Phase 4.">
                <Input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} placeholder="e.g. Why compounding is the 8th wonder of the world" />
              </Field>
            )}

            <Field id="script" label={mode === 'editor' ? 'Notes or script (optional)' : 'Script'} hint={`${script.length.toLocaleString()} / 20,000 characters`}>
              <Textarea value={script} onChange={(e) => setScript(e.target.value)} maxLength={20000} rows={8} placeholder={mode === 'avatar' ? 'What should your avatar say?' : 'Write or paste your script…'} />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-6">
            <h2 className="text-lg font-bold">Customize</h2>
            <CustomizeForm value={custom} onChange={setCustom} />
          </div>
        )}

        {step === 3 && mode && (
          <div className="grid gap-6">
            <h2 className="text-lg font-bold">Review & generate</h2>
            <dl className="grid gap-x-8 gap-y-3 rounded-xl bg-muted/40 p-5 text-sm sm:grid-cols-2">
              {[
                ['Mode', modeName(mode)],
                ['Title', title],
                ['Style', styleName(custom.style)],
                ['Format', custom.aspectRatio],
                ['Language', LANGUAGES.find((l) => l.id === custom.settings.language)?.name],
                ['Resolution', custom.settings.resolution],
                ['Target length', `${custom.settings.targetDurationSec}s`],
                ['Captions', custom.settings.captionsEnabled ? 'On' : 'Off'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-border/60 pb-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <Notice tone="info" title="AI generation isn’t switched on yet">
              Transcription, editing and rendering are being built in the next phase. Your project will be saved as a draft with these settings, and you’ll be able to generate it — with the credit cost shown up front — as soon as it’s available.
            </Notice>
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
              <Button variant="outline" disabled title="Available when the rendering pipeline launches">
                <Lock /> Generate
              </Button>
              <Button variant="gradient" onClick={() => save.mutate()} loading={save.isPending} disabled={Boolean(unverified)}>
                <Save /> Save draft
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
