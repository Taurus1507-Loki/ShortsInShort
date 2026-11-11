import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Clock, Loader2, Mic, Plus, ShieldCheck, Square, Trash2, Upload, XCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input, Select } from '../ui/input';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Notice, Skeleton } from '../ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/overlays';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, ApiError, errorMessage } from '@/lib/api';
import { keys, queryClient, useCloneStatus, useCustomVoices } from '@/lib/queries';
import { formatDuration, uploadAudio } from '@/lib/upload';
import { LANGUAGES } from '@/config/options';
import { cn, timeAgo } from '@/lib/utils';
import type { Asset, CustomVoice } from '@/types/api';

const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.webm,.ogg';

/** Records from the microphone and hands back a File ready to upload. */
function Recorder({ onRecorded, label, maxSec = 300 }: { onRecorded: (f: File) => void; label: string; maxSec?: number }) {
  const [state, setState] = useState<'idle' | 'recording'>('idle');
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearInterval(timer.current);
      rec.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const mime = (r.mimeType || 'audio/webm').split(';')[0]!;
        const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
        onRecorded(new File([new Blob(chunks, { type: mime })], `recording-${Date.now()}.${ext}`, { type: mime }));
      };
      r.start(1000);
      rec.current = r;
      setSecs(0);
      setState('recording');
      timer.current = window.setInterval(() => {
        setSecs((s) => {
          if (s + 1 >= maxSec) stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      setError('Microphone access was blocked. Allow it in your browser, or upload a recording instead.');
    }
  };
  const stop = () => {
    window.clearInterval(timer.current);
    if (rec.current?.state === 'recording') rec.current.stop();
    setState('idle');
  };

  return (
    <div className="grid gap-1.5">
      {state === 'idle' ? (
        <Button type="button" variant="outline" onClick={start}>
          <Mic /> {label}
        </Button>
      ) : (
        <Button type="button" variant="destructive" onClick={stop}>
          <Square /> Stop recording · {formatDuration(secs)}
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Uploads one File as a voice sample / consent recording, with progress. */
function useAudioUpload(purpose: 'voice_sample' | 'consent') {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const upload = async (file: File): Promise<Asset | null> => {
    setBusy(true);
    setProgress(0);
    try {
      return await uploadAudio(file, purpose, { onProgress: setProgress });
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, progress, upload };
}

const STEP_TITLES = ['Whose voice', 'Voice samples', 'Spoken consent', 'Confirm'];

function AddVoiceDialog({ open, onOpenChange, minSampleSec }: { open: boolean; onOpenChange: (o: boolean) => void; minSampleSec: number }) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [relationship, setRelationship] = useState<'self' | 'other'>('self');
  const [name, setName] = useState('');
  const [subjectName, setSubjectName] = useState(user?.fullName ?? '');
  const [subjectEmail, setSubjectEmail] = useState('');
  const [language, setLanguage] = useState('en');
  const [samples, setSamples] = useState<Asset[]>([]);
  const [consent, setConsent] = useState<Asset | null>(null);
  const [statement, setStatement] = useState('');
  const [checks, setChecks] = useState({ rightsAndConsent: false, notPublicFigure: false, acceptsUsePolicy: false });
  const sampleUp = useAudioUpload('voice_sample');
  const consentUp = useAudioUpload('consent');
  const fileInput = useRef<HTMLInputElement>(null);
  const consentInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep(0);
    setRelationship('self');
    setName('');
    setSubjectName(user?.fullName ?? '');
    setSubjectEmail('');
    setSamples([]);
    setConsent(null);
    setChecks({ rightsAndConsent: false, notPublicFigure: false, acceptsUsePolicy: false });
  };

  const total = samples.reduce((t, s) => t + (s.durationSec ?? 0), 0);
  const self = relationship === 'self';
  const who = self ? 'you' : subjectName.split(' ')[0] || 'they';

  // The statement names the person, so fetch it whenever we reach the consent step.
  useEffect(() => {
    if (step !== 2 || subjectName.trim().length < 2) return;
    api<{ data: { statement: string } }>(`/voices/custom/statement?subjectName=${encodeURIComponent(subjectName.trim())}`)
      .then((r) => setStatement(r.data.statement))
      .catch((e) => toast.error(errorMessage(e)));
  }, [step, subjectName]);

  const addSample = async (f: File) => {
    const a = await sampleUp.upload(f);
    if (a) setSamples((s) => [...s, a]);
  };

  const create = useMutation({
    mutationFn: () =>
      api<{ data: CustomVoice }>('/voices/custom', {
        method: 'POST',
        body: {
          name: name.trim(),
          language,
          relationship,
          subjectName: subjectName.trim(),
          ...(self ? {} : { subjectEmail: subjectEmail.trim() }),
          attestations: checks,
          statementAssetId: consent!.id,
          sampleAssetIds: samples.map((s) => s.id),
        },
      }).then((r) => r.data),
    onSuccess: (v) => {
      queryClient.invalidateQueries({ queryKey: keys.customVoices });
      queryClient.invalidateQueries({ queryKey: keys.cloneStatus });
      toast.success(v.status === 'awaiting_consent' ? `Request sent — ${subjectName} must confirm by email` : 'Consent verified — creating your voice');
      onOpenChange(false);
      reset();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'CONSENT_NOT_MATCHED') {
        setConsent(null);
        setStep(2);
      }
      toast.error(errorMessage(e), { duration: 9000 });
    },
  });

  const canNext = [
    name.trim().length >= 2 && subjectName.trim().length >= 2 && (self || /\S+@\S+\.\S+/.test(subjectEmail)),
    total >= minSampleSec && !sampleUp.busy,
    Boolean(consent) && !consentUp.busy,
    checks.rightsAndConsent && checks.notPublicFigure && checks.acceptsUsePolicy,
  ][step];

  return (
    <Dialog open={open} onOpenChange={(o) => (!create.isPending ? onOpenChange(o) : undefined)}>
      <DialogContent className="max-w-xl">
        <DialogTitle className="text-lg font-semibold">Add a custom voice</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Step {step + 1} of 4 · {STEP_TITLES[step]}
        </DialogDescription>
        <div className="flex gap-1.5" aria-hidden>
          {STEP_TITLES.map((_, i) => (
            <span key={i} className={cn('h-1 flex-1 rounded-full', i <= step ? 'bg-primary' : 'bg-muted')} />
          ))}
        </div>

        {step === 0 && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Whose voice">
              {(['self', 'other'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={relationship === r}
                  onClick={() => {
                    setRelationship(r);
                    setSubjectName(r === 'self' ? (user?.fullName ?? '') : '');
                  }}
                  className={cn('rounded-lg border p-3 text-left text-sm', relationship === r ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40')}
                >
                  <span className="block font-semibold">{r === 'self' ? 'My own voice' : 'Someone else’s voice'}</span>
                  <span className="text-xs text-muted-foreground">{r === 'self' ? 'You record the samples and the consent sentence.' : 'They record the consent sentence and confirm by email.'}</span>
                </button>
              ))}
            </div>
            <Field id="cv-name" label="Voice name" hint="How it appears in the voice picker.">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={self ? 'e.g. My narration voice' : 'e.g. Ravi – presenter'} />
            </Field>
            <Field id="cv-subject" label={self ? 'Your full name' : 'Their full name'} hint="Said aloud in the consent sentence.">
              <Input value={subjectName} onChange={(e) => setSubjectName(e.target.value)} maxLength={80} />
            </Field>
            {!self && (
              <Field id="cv-email" label="Their email" hint="They get a link to confirm — nothing is created until they do — and a link to withdraw at any time.">
                <Input type="email" value={subjectEmail} onChange={(e) => setSubjectEmail(e.target.value)} maxLength={254} placeholder="name@example.com" />
              </Field>
            )}
            <Field id="cv-lang" label="Main language" hint="The language the samples are spoken in.">
              <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4">
            <Notice tone="info" title="For the best clone">
              1–2 minutes of {self ? 'you' : who} talking naturally, in a quiet room, one person only, no music. At least {minSampleSec} seconds in total.
            </Notice>
            <div className="grid gap-2 sm:grid-cols-2">
              <Recorder label="Record a sample" onRecorded={addSample} maxSec={180} />
              <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={sampleUp.busy}>
                <Upload /> Upload recordings
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept={AUDIO_ACCEPT}
                multiple
                hidden
                onChange={async (e) => {
                  for (const f of Array.from(e.target.files ?? [])) await addSample(f);
                  e.target.value = '';
                }}
              />
            </div>
            {sampleUp.busy && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Uploading and checking… {Math.round(sampleUp.progress * 100)}%
              </p>
            )}
            <ul className="grid gap-1.5">
              {samples.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                  <span className="truncate">{s.originalName}</span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {formatDuration(s.durationSec)}
                    <button type="button" aria-label={`Remove ${s.originalName}`} onClick={() => setSamples((x) => x.filter((y) => y.id !== s.id))}>
                      <XCircle className="h-4 w-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <p className={cn('text-sm', total >= minSampleSec ? 'text-success' : 'text-muted-foreground')}>
              Total: {formatDuration(total)} {total >= minSampleSec ? '✓' : `· ${Math.ceil(minSampleSec - total)} s more needed`}
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <p className="text-sm">{self ? 'Read this sentence aloud, exactly, in English:' : `Ask ${who} to read this sentence aloud, exactly, in English:`}</p>
            <blockquote className="rounded-lg border-l-4 border-primary bg-primary/5 px-4 py-3 text-base font-medium leading-relaxed">{statement || <Skeleton className="h-12" />}</blockquote>
            <p className="text-xs text-muted-foreground">We check the recording with speech recognition. It’s kept as proof of consent and deleted if consent is withdrawn.</p>
            {consent ? (
              <div className="flex items-center justify-between rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success" /> Consent recording ready ({formatDuration(consent.durationSec)})
                </span>
                <Button size="sm" variant="ghost" onClick={() => setConsent(null)}>
                  Redo
                </Button>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <Recorder label="Record the sentence" maxSec={60} onRecorded={async (f) => setConsent(await consentUp.upload(f))} />
                <Button type="button" variant="outline" onClick={() => consentInput.current?.click()} disabled={consentUp.busy}>
                  <Upload /> Upload a recording
                </Button>
                <input
                  ref={consentInput}
                  type="file"
                  accept={AUDIO_ACCEPT}
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setConsent(await consentUp.upload(f));
                    e.target.value = '';
                  }}
                />
              </div>
            )}
            {consentUp.busy && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Uploading… {Math.round(consentUp.progress * 100)}%
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-3 text-sm">
            {[
              ['rightsAndConsent', self ? 'This is my own voice, and I agree to an AI copy of it.' : `${subjectName || 'This person'} has agreed to an AI copy of their voice, and recorded the consent sentence themselves.`],
              ['notPublicFigure', 'This is not a celebrity, politician or other public figure, and I won’t use the voice to impersonate anyone.'],
              ['acceptsUsePolicy', 'I’ll only use this voice for content the person would approve, and I understand it is deleted if consent is withdrawn.'],
            ].map(([k, label]) => (
              <label key={k} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                  checked={checks[k as keyof typeof checks]}
                  onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))}
                />
                <span>{label}</span>
              </label>
            ))}
            {!self && <Notice tone="info">{subjectName} will get an email at {subjectEmail} to confirm. The voice is only created after they do.</Notice>}
          </div>
        )}

        <div className="flex justify-between gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={() => (step === 0 ? onOpenChange(false) : setStep((s) => s - 1))} disabled={create.isPending}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {step < 3 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Continue
            </Button>
          ) : (
            <Button variant="gradient" onClick={() => create.mutate()} loading={create.isPending} disabled={!canNext}>
              <ShieldCheck /> {self ? 'Verify consent & create voice' : 'Verify & send request'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ v }: { v: CustomVoice }) {
  const map: Record<CustomVoice['status'], { label: string; variant: 'success' | 'muted' | 'warning' | 'destructive' }> = {
    ready: { label: 'Ready', variant: 'success' },
    cloning: { label: 'Creating…', variant: 'muted' },
    awaiting_consent: { label: `Waiting for ${v.consent?.subjectName.split(' ')[0] ?? 'consent'}`, variant: 'warning' },
    failed: { label: 'Failed', variant: 'destructive' },
    revoked: { label: 'Withdrawn', variant: 'muted' },
  };
  const m = map[v.status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

/** "Your voices": consented clones owned by this workspace. */
export function CustomVoices() {
  const { data: status } = useCloneStatus();
  const { data: voices, isLoading } = useCustomVoices();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<CustomVoice | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/voices/custom/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.customVoices });
      queryClient.invalidateQueries({ queryKey: keys.cloneStatus });
      queryClient.invalidateQueries({ queryKey: keys.voices });
      toast.success('Voice and recordings deleted');
      setRemoving(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const blocked = !status
    ? 'loading'
    : !status.voicesConfigured
      ? 'AI voices aren’t configured on this server (SARVAM_API_KEY or ELEVENLABS_API_KEY).'
      : !status.consentCheckConfigured
        ? 'Consent recordings can’t be checked: speech-to-text (DEEPGRAM_API_KEY) isn’t configured.'
        : status.limit === 0
          ? 'Custom voices are available on paid plans.'
          : status.used >= status.limit
            ? `Your plan includes ${status.limit} custom voice${status.limit === 1 ? '' : 's'}. Remove one to add another.`
            : null;

  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Your voices
          </CardTitle>
          <CardDescription className="mt-1.5">
            Clone your own voice, or someone else’s with their spoken and emailed consent. The person can withdraw at any time, which deletes the AI voice and the recordings.
            {status && status.limit > 0 && ` ${status.used} of ${status.limit} used.`}
          </CardDescription>
        </div>
        <Button variant="gradient" className="shrink-0" onClick={() => setAdding(true)} disabled={Boolean(blocked)} title={blocked && blocked !== 'loading' ? blocked : undefined}>
          <Plus /> Add a voice
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {blocked && blocked !== 'loading' && <Notice tone="warning">{blocked}</Notice>}
        {isLoading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : !voices?.length ? (
          <p className="text-sm text-muted-foreground">No custom voices yet.</p>
        ) : (
          <ul className="grid gap-2">
            {voices.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold">
                    {v.name} <StatusBadge v={v} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {v.consent?.relationship === 'self' ? 'Your voice' : v.consent?.subjectName} · {formatDuration(v.sampleDurationSec)} of samples · added {timeAgo(v.createdAt)}
                    {v.consent?.grantedAt && ` · consent ${v.consent.relationship === 'self' ? 'recorded' : 'confirmed'} ${timeAgo(v.consent.grantedAt)}`}
                  </p>
                  {v.status === 'awaiting_consent' && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-warning">
                      <Clock className="h-3.5 w-3.5" /> Email sent to {v.consent?.subjectEmail} — the link is valid for 7 days.
                    </p>
                  )}
                  {v.status === 'cloning' && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating the voice — usually under a minute.
                    </p>
                  )}
                  {v.status === 'failed' && v.failureReason && <p className="mt-1 text-xs text-destructive">{v.failureReason}</p>}
                  {v.status === 'ready' && <p className="mt-1 text-xs text-success">Available in the voice picker for voiceovers.</p>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setRemoving(v)}>
                  <Trash2 /> Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {status && <AddVoiceDialog open={adding} onOpenChange={setAdding} minSampleSec={status.minSampleSec} />}
      <Dialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">Remove “{removing?.name}”?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            This withdraws consent, deletes the AI voice at the provider and deletes the voice samples and consent recording. Voiceovers already made stay in your projects. This can’t be undone.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>
              Remove voice
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
