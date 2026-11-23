import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Clock, ImagePlus, Loader2, Plus, RotateCcw, ScanFace, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Notice, Skeleton } from '../ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/overlays';
import { AUDIO_ACCEPT, Recorder, useAudioUpload } from './CustomVoices';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, ApiError, errorMessage } from '@/lib/api';
import { keys, queryClient, useAssetUrl } from '@/lib/queries';
import { formatDuration, uploadVideo } from '@/lib/upload';
import { cn, timeAgo } from '@/lib/utils';
import type { Asset, PhotoAvatar, PhotoAvatarStatus } from '@/types/api';

const PHOTO_KEY = ['photo-avatars'] as const;
const STATUS_KEY = ['photo-avatars-status'] as const;

const usePhotoAvatars = () =>
  useQuery({
    queryKey: PHOTO_KEY,
    queryFn: () => api<{ data: PhotoAvatar[] }>('/avatars/photo').then((r) => r.data),
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === 'creating') ? 4000 : false),
  });
const usePhotoStatus = () => useQuery({ queryKey: STATUS_KEY, queryFn: () => api<{ data: PhotoAvatarStatus }>('/avatars/photo/status').then((r) => r.data) });

const refresh = () => {
  queryClient.invalidateQueries({ queryKey: PHOTO_KEY });
  queryClient.invalidateQueries({ queryKey: STATUS_KEY });
  queryClient.invalidateQueries({ queryKey: keys.avatars });
  queryClient.invalidateQueries({ queryKey: keys.me });
};

const STEPS = ['Whose face', 'Photo', 'Spoken consent', 'Confirm'];

function AddAvatarDialog({ open, onOpenChange, credits }: { open: boolean; onOpenChange: (o: boolean) => void; credits: number }) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [relationship, setRelationship] = useState<'self' | 'other'>('self');
  const [name, setName] = useState('');
  const [subjectName, setSubjectName] = useState(user?.fullName ?? '');
  const [subjectEmail, setSubjectEmail] = useState('');
  const [photo, setPhoto] = useState<Asset | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [consent, setConsent] = useState<Asset | null>(null);
  const [statement, setStatement] = useState('');
  const [checks, setChecks] = useState({ rightsAndConsent: false, notPublicFigure: false, acceptsUsePolicy: false });
  const consentUp = useAudioUpload('consent');
  const photoInput = useRef<HTMLInputElement>(null);
  const consentInput = useRef<HTMLInputElement>(null);
  const photoUrl = useAssetUrl(photo?.id);
  const self = relationship === 'self';
  const who = self ? 'you' : subjectName.split(' ')[0] || 'they';

  const reset = () => {
    setStep(0);
    setRelationship('self');
    setName('');
    setSubjectName(user?.fullName ?? '');
    setSubjectEmail('');
    setPhoto(null);
    setConsent(null);
    setChecks({ rightsAndConsent: false, notPublicFigure: false, acceptsUsePolicy: false });
  };

  useEffect(() => {
    if (step !== 2 || subjectName.trim().length < 2) return;
    api<{ data: { statement: string } }>(`/avatars/photo/statement?subjectName=${encodeURIComponent(subjectName.trim())}`)
      .then((r) => setStatement(r.data.statement))
      .catch((e) => toast.error(errorMessage(e)));
  }, [step, subjectName]);

  const pickPhoto = async (f: File) => {
    setPhotoBusy(true);
    try {
      setPhoto(await uploadVideo(f, { purpose: 'avatar_photo' }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  };

  const create = useMutation({
    mutationFn: () =>
      api<{ data: PhotoAvatar }>('/avatars/photo', {
        method: 'POST',
        body: {
          name: name.trim(),
          relationship,
          subjectName: subjectName.trim(),
          ...(self ? {} : { subjectEmail: subjectEmail.trim() }),
          attestations: checks,
          statementAssetId: consent!.id,
          photoAssetId: photo!.id,
        },
      }).then((r) => r.data),
    onSuccess: (a) => {
      refresh();
      toast.success(a.status === 'awaiting_consent' ? `Request sent — ${subjectName} must confirm by email` : 'Consent verified — creating your avatar');
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
    Boolean(photo) && !photoBusy,
    Boolean(consent) && !consentUp.busy,
    checks.rightsAndConsent && checks.notPublicFigure && checks.acceptsUsePolicy,
  ][step];

  return (
    <Dialog open={open} onOpenChange={(o) => (!create.isPending ? onOpenChange(o) : undefined)}>
      <DialogContent className="max-w-xl">
        <DialogTitle className="text-lg font-semibold">Create your avatar</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Step {step + 1} of 4 · {STEPS[step]}
        </DialogDescription>
        <div className="flex gap-1.5" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={cn('h-1 flex-1 rounded-full', i <= step ? 'bg-primary' : 'bg-muted')} />
          ))}
        </div>

        {step === 0 && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Whose face">
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
                  <span className="block font-semibold">{r === 'self' ? 'My own face' : 'Someone else’s face'}</span>
                  <span className="text-xs text-muted-foreground">{r === 'self' ? 'Your photo and your spoken consent.' : 'They record the consent sentence and confirm by email.'}</span>
                </button>
              ))}
            </div>
            <Field id="pa-name" label="Avatar name" hint="How it appears in the presenter picker.">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={self ? 'e.g. Me – office look' : 'e.g. Dr. Ravi'} />
            </Field>
            <Field id="pa-subject" label={self ? 'Your full name' : 'Their full name'} hint="Said aloud in the consent sentence.">
              <Input value={subjectName} onChange={(e) => setSubjectName(e.target.value)} maxLength={80} />
            </Field>
            {!self && (
              <Field id="pa-email" label="Their email" hint="They get a link to confirm — nothing is created or charged until they do — and a link to withdraw at any time.">
                <Input type="email" value={subjectEmail} onChange={(e) => setSubjectEmail(e.target.value)} maxLength={254} placeholder="name@example.com" />
              </Field>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4">
            <Notice tone="info" title="For the best avatar">
              One clear, front-facing photo of {self ? 'you' : who}: whole head in frame, good light, neutral expression, nobody else in the picture, no sunglasses. PNG or JPG, at least 512 × 512 pixels.
            </Notice>
            {photo && photoUrl.data ? (
              <div className="flex items-center gap-4">
                <img src={photoUrl.data} alt="Chosen photo" className="h-32 w-32 rounded-lg border border-border object-cover" />
                <Button variant="outline" size="sm" onClick={() => setPhoto(null)}>
                  Choose another
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={() => photoInput.current?.click()} loading={photoBusy}>
                <ImagePlus /> Upload a photo
              </Button>
            )}
            <input
              ref={photoInput}
              type="file"
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await pickPhoto(f);
                e.target.value = '';
              }}
            />
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
              ['rightsAndConsent', self ? 'This is my own face, and I agree to an AI avatar of it.' : `${subjectName || 'This person'} has agreed to an AI avatar of their face, and recorded the consent sentence themselves.`],
              ['notPublicFigure', 'This is not a celebrity, politician or other public figure, and I won’t use the avatar to impersonate anyone.'],
              ['acceptsUsePolicy', 'I’ll only use this avatar for content the person would approve. Videos are labelled “AI-generated”, and the avatar is deleted if consent is withdrawn.'],
            ].map(([k, label]) => (
              <label key={k} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={checks[k as keyof typeof checks]} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))} />
                <span>{label}</span>
              </label>
            ))}
            <Notice tone="info">
              {self ? `Creating the avatar costs ${credits} credits, once.` : `${subjectName} will get an email at ${subjectEmail} to confirm. The avatar is created — and ${credits} credits charged — only after they do.`}
            </Notice>
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
              <ShieldCheck /> {self ? `Verify consent & create (${credits} credits)` : 'Verify & send request'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ a }: { a: PhotoAvatar }) {
  const map: Record<PhotoAvatar['status'], { label: string; variant: 'success' | 'muted' | 'warning' | 'destructive' }> = {
    ready: { label: 'Ready', variant: 'success' },
    creating: { label: 'Creating…', variant: 'muted' },
    awaiting_consent: { label: `Waiting for ${a.consent?.subjectName.split(' ')[0] ?? 'consent'}`, variant: 'warning' },
    failed: { label: 'Failed', variant: 'destructive' },
    revoked: { label: 'Withdrawn', variant: 'muted' },
  };
  const m = map[a.status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

/** "Your avatars": talking avatars made from one consented photo. */
export function PhotoAvatars() {
  const { data: status } = usePhotoStatus();
  const { data: avatars, isLoading } = usePhotoAvatars();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PhotoAvatar | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/avatars/photo/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast.success('Avatar and photo deleted');
      setRemoving(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/avatars/photo/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      refresh();
      toast.success('Trying again');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const blocked = !status
    ? 'loading'
    : !status.avatarsConfigured
      ? 'Talking avatars aren’t configured on this server (HEYGEN_API_KEY).'
      : !status.consentCheckConfigured
        ? 'Consent recordings can’t be checked: speech-to-text (DEEPGRAM_API_KEY) isn’t configured.'
        : status.limit === 0
          ? 'Photo avatars are available on paid plans.'
          : status.used >= status.limit
            ? `Your plan includes ${status.limit} photo avatar${status.limit === 1 ? '' : 's'}. Remove one to add another.`
            : null;

  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ScanFace className="h-5 w-5 text-primary" /> Your avatars
          </CardTitle>
          <CardDescription className="mt-1.5">
            One photo becomes a talking presenter that speaks your scripts — no camera, no studio. Pair it with your cloned voice for videos that look and sound like you.
            {status && ` Creating one costs ${status.createCredits} credits once; videos with it cost ${status.perMinuteCredits} credits per minute, everything included.`}
            {status && status.limit > 0 && ` ${status.used} of ${status.limit} used.`}
          </CardDescription>
        </div>
        <Button variant="gradient" className="shrink-0" onClick={() => setAdding(true)} disabled={Boolean(blocked)} title={blocked && blocked !== 'loading' ? blocked : undefined}>
          <Plus /> Create avatar
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {blocked && blocked !== 'loading' && <Notice tone="warning">{blocked}</Notice>}
        {isLoading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : !avatars?.length ? (
          <p className="text-sm text-muted-foreground">No avatars yet.</p>
        ) : (
          <ul className="grid gap-2">
            {avatars.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
                {a.previewImageUrl ? (
                  <img src={a.previewImageUrl} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-md bg-muted">
                    <ScanFace className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold">
                    {a.name} <StatusBadge a={a} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.consent?.relationship === 'self' ? 'Your face' : a.consent?.subjectName} · added {timeAgo(a.createdAt)}
                  </p>
                  {a.status === 'awaiting_consent' && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-warning">
                      <Clock className="h-3.5 w-3.5" /> Email sent to {a.consent?.subjectEmail} — the link is valid for 7 days.
                    </p>
                  )}
                  {a.status === 'creating' && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating the avatar — usually a few minutes.
                    </p>
                  )}
                  {a.status === 'failed' && a.failureReason && <p className="mt-1 text-xs text-destructive">{a.failureReason}</p>}
                  {a.status === 'ready' && <p className="mt-1 text-xs text-success">Ready — pick it as the presenter in an AI Avatar video.</p>}
                </div>
                <div className="flex gap-1">
                  {a.status === 'failed' && (
                    <Button size="sm" variant="outline" onClick={() => retry.mutate(a.id)} loading={retry.isPending}>
                      <RotateCcw /> Retry
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(a)}>
                    <Trash2 /> Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {status && <AddAvatarDialog open={adding} onOpenChange={setAdding} credits={status.createCredits} />}
      <Dialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">Remove “{removing?.name}”?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            This withdraws consent, deletes the avatar at the provider and deletes the photo and consent recording. Videos already made stay in your projects. This can’t be undone.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>
              Remove avatar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
