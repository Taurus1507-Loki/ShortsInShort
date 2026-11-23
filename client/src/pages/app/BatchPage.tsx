import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Coins, Layers, Loader2, PlayCircle } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { DEFAULT_SETTINGS } from '@/components/app/projects';
import { VoicePicker } from '@/components/app/VoicePicker';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Notice } from '@/components/ui/primitives';
import { LANGUAGES } from '@/config/options';
import { api, errorMessage } from '@/lib/api';
import { queryClient, useBrandKit, useMeta } from '@/lib/queries';
import { useAuth } from '@/features/auth/AuthProvider';
import { cn } from '@/lib/utils';
import { NICHE_LABEL, useTemplates } from '@/features/templates';
import type { Project, ProjectSettings } from '@/types/api';

/** Videos per batch (same limit as the server). */
const MAX_VIDEOS = 30;
const SEPARATOR = /^\s*-{3,}\s*$/m;
const RESOLUTIONS: Array<ProjectSettings['resolution']> = ['720p', '1080p', '4k'];

/** Scripts pasted as one text, separated by a line with "---". */
export function splitScripts(text: string): Array<{ title: string; script: string }> {
  return text
    .split(SEPARATOR)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((script) => {
      const first = script.split(/(?<=[.!?।])\s+/)[0] ?? script;
      const words = first.split(/\s+/);
      const title = (words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '')).replace(/[.!?।]+$/, '').slice(0, 120);
      return { title, script };
    });
}

interface BatchSummary {
  id: string;
  name: string;
  templateId: string | null;
  projectIds: string[];
  estimatedCredits: number;
  createdAt: string;
  videos?: number;
  done?: number;
  stopped?: number;
}
interface Estimate {
  videos: Array<{ durationSec: number; narration: number; export: number; total: number }>;
  total: number;
  balance: number;
}

export default function BatchPage() {
  const { id } = useParams();
  return id ? <BatchDetail id={id} /> : <BatchCreate />;
}

function BatchCreate() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: templates } = useTemplates();
  const faceless = useMemo(() => (templates ?? []).filter((t) => t.mode === 'faceless'), [templates]);
  const [templateId, setTemplateId] = useState(params.get('template') ?? '');
  const template = faceless.find((t) => t.id === templateId) ?? null;
  const { data: kit } = useBrandKit();
  const [name, setName] = useState('');
  const [style, setStyle] = useState<'stock' | 'motion'>('motion');
  const [language, setLanguage] = useState<ProjectSettings['language']>('en');
  const [voiceId, setVoiceId] = useState('');
  const [text, setText] = useState('');
  // Export quality: up to what the plan allows (1080p by default when allowed).
  const { workspace } = useAuth();
  const { data: meta } = useMeta();
  const planMax = (meta?.plans.find((p) => p.id === workspace?.plan)?.maxResolution ?? '720p') as ProjectSettings['resolution'];
  const allowed = RESOLUTIONS.slice(0, RESOLUTIONS.indexOf(planMax) + 1);
  const [resolution, setResolution] = useState<ProjectSettings['resolution'] | null>(null);
  const res = resolution && allowed.includes(resolution) ? resolution : allowed.includes('1080p') ? '1080p' : (allowed[allowed.length - 1] ?? '720p');

  // A template sets the look, the language and a name; pick the first faceless template by default.
  useEffect(() => {
    if (!templateId && faceless.length) setTemplateId(faceless[0]!.id);
  }, [faceless, templateId]);
  useEffect(() => {
    if (!template) return;
    setStyle(template.settings.facelessStyle === 'stock' ? 'stock' : 'motion');
    if (template.settings.language) setLanguage(template.settings.language);
    setName((n) => n || `${template.name} series`);
  }, [template]);

  const videos = useMemo(() => splitScripts(text), [text]);
  const tooLong = videos.findIndex((v) => v.script.length > 5000);
  const tooShort = videos.findIndex((v) => v.script.length < 20);
  const settings: ProjectSettings = useMemo(
    () => ({
      ...DEFAULT_SETTINGS,
      ...(kit?.applyToNewProjects ? { captionStyle: kit.captionStyle, captionPosition: kit.captionPosition, captionSize: kit.captionSize, highlightColor: kit.highlightColor } : {}),
      ...(template?.settings ?? {}),
      facelessStyle: style,
      language,
      voiceId,
      resolution: res,
    }),
    [kit, template, style, language, voiceId, res],
  );
  const body = { name: name.trim() || 'My batch', templateId: template?.id, aspectRatio: template?.aspectRatio ?? '9:16', style: template?.style ?? 'viral', settings, videos };
  const ready = Boolean(voiceId) && videos.length > 0 && videos.length <= MAX_VIDEOS && tooLong < 0 && tooShort < 0;

  // Live price (debounced) whenever the scripts, voice or look change.
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!ready) {
      setEstimate(null);
      return;
    }
    const h = setTimeout(() => {
      api<{ data: Estimate }>('/batches/estimate', { method: 'POST', body })
        .then((r) => {
          setEstimate(r.data);
          setEstimateError(null);
        })
        .catch((e) => setEstimateError(errorMessage(e)));
    }, 600);
    return () => clearTimeout(h);
  }, [key, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useMutation({
    mutationFn: () => api<{ data: { batch: BatchSummary; started: number } }>('/batches', { method: 'POST', body }).then((r) => r.data),
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.success(`${d.started} videos started`);
      navigate(`/app/batch/${d.batch.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Batch create" description="A month of reels in one go: pick a template and a voice, paste your scripts, and every video is voiced, illustrated and exported for you." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Look</CardTitle>
              <CardDescription>Every video in the batch uses this template, your Brand Kit colours and the same voice — so your page looks consistent.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm sm:col-span-2">
                <span className="font-medium">Template</span>
                <Select id="batch-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  {faceless.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {t.niches.map((n) => NICHE_LABEL[n]).join(', ')}
                    </option>
                  ))}
                </Select>
                {template && <span className="text-xs text-muted-foreground">{template.description}</span>}
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Visuals</span>
                <Select id="batch-style" value={style} onChange={(e) => setStyle(e.target.value as 'stock')}>
                  <option value="motion">Animated scenes</option>
                  <option value="stock">Stock footage</option>
                </Select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Language</span>
                <Select id="batch-language" value={language} onChange={(e) => setLanguage(e.target.value as ProjectSettings['language'])}>
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Quality</span>
                <Select id="batch-resolution" value={res} onChange={(e) => setResolution(e.target.value as ProjectSettings['resolution'])}>
                  {allowed.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Batch name</span>
                <Input id="batch-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. November health tips" />
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Voice</CardTitle>
            </CardHeader>
            <CardContent>
              <VoicePicker value={voiceId} onChange={(v) => setVoiceId(v.id)} compact language={language} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Scripts</CardTitle>
              <CardDescription>
                Paste one script per video and put a line with <code className="rounded bg-muted px-1">---</code> between them. Up to {MAX_VIDEOS} videos.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Textarea
                id="batch-scripts"
                rows={12}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`${template?.script ?? 'First video script…'}\n---\nSecond video script…\n---\nThird video script…`}
              />
              {videos.length > 0 && (
                <ol className="grid gap-1 text-xs text-muted-foreground">
                  {videos.slice(0, MAX_VIDEOS + 5).map((v, i) => (
                    <li key={i} className={cn('flex justify-between gap-2', (v.script.length > 5000 || v.script.length < 20 || i >= MAX_VIDEOS) && 'text-destructive')}>
                      <span className="truncate">
                        {i + 1}. {v.title}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        ~{estimate?.videos[i]?.durationSec ?? Math.round(v.script.split(/\s+/).length / 2.5)} s
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {videos.length > MAX_VIDEOS && <Notice tone="warning">That’s {videos.length} scripts — a batch holds up to {MAX_VIDEOS}. Split them into two batches.</Notice>}
              {tooShort >= 0 && <Notice tone="warning">Script {tooShort + 1} is too short.</Notice>}
              {tooLong >= 0 && <Notice tone="warning">Script {tooLong + 1} is longer than 5,000 characters.</Notice>}
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-4 lg:sticky lg:top-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <p className="flex justify-between">
                <span className="text-muted-foreground">Videos</span>
                <strong>{Math.min(videos.length, MAX_VIDEOS)}</strong>
              </p>
              {estimate && (
                <>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Voiceovers</span>
                    <span>{estimate.videos.reduce((t, v) => t + v.narration, 0)} credits</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Exports (estimated)</span>
                    <span>{estimate.videos.reduce((t, v) => t + v.export, 0)} credits</span>
                  </p>
                  <p className="flex justify-between border-t border-border pt-2 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Coins className="h-4 w-4 text-highlight" /> Total
                    </span>
                    <span>
                      ~{estimate.total} of {estimate.balance}
                    </span>
                  </p>
                </>
              )}
              {!voiceId && <p className="text-xs text-muted-foreground">Choose a voice to see the price.</p>}
              {estimateError && <Notice tone="warning">{estimateError}</Notice>}
              {estimate && estimate.balance < estimate.total && (
                <Notice tone="warning">
                  Not enough credits. <Link to="/app/billing" className="underline">Top up</Link> or remove some scripts.
                </Notice>
              )}
              <Button variant="gradient" onClick={() => create.mutate()} loading={create.isPending} disabled={!ready || !estimate || estimate.balance < estimate.total}>
                <Layers /> Create {Math.min(videos.length, MAX_VIDEOS) || ''} videos
              </Button>
              <p className="text-[11px] text-muted-foreground">Each step is charged as it starts, at the same price as making the video by hand. If a video stops (for example, no stock clip fits a line), the rest carry on and you can finish it from its page.</p>
            </CardContent>
          </Card>
          <RecentBatches />
        </div>
      </div>
    </div>
  );
}

function RecentBatches() {
  const { data } = useQuery({ queryKey: ['batches'], queryFn: () => api<{ data: BatchSummary[] }>('/batches').then((r) => r.data) });
  if (!data?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your batches</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {data.slice(0, 8).map((b) => (
          <Link key={b.id} to={`/app/batch/${b.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
            <span className="truncate">{b.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {b.done ?? 0}/{b.videos ?? b.projectIds.length} done
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

/** Where a batch video is: the step it's on, done, or stopped (with the reason). */
function stepOf(p: Project): { label: string; tone: 'muted' | 'accent' | 'success' | 'destructive' } {
  if (p.autopilot?.state === 'done' || (p.outputAssetId && p.status === 'completed')) return { label: 'Ready', tone: 'success' };
  if (p.autopilot?.state === 'stopped' || p.status === 'failed') return { label: 'Needs you', tone: 'destructive' };
  if (!p.narrationAssetId) return { label: 'Voiceover', tone: 'accent' };
  if (!p.scenes?.length) return { label: 'Planning scenes', tone: 'accent' };
  return { label: 'Exporting', tone: 'accent' };
}

function BatchDetail({ id }: { id: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['batch', id],
    queryFn: () => api<{ data: { batch: BatchSummary; projects: Project[] } }>(`/batches/${id}`).then((r) => r.data),
    refetchInterval: (q) => (q.state.data?.projects.some((p) => p.autopilot?.state === 'running') ? 3000 : false),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError || !data) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const { batch, projects } = data;
  const done = projects.filter((p) => stepOf(p).tone === 'success').length;
  const stuck = projects.filter((p) => stepOf(p).tone === 'destructive').length;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={batch.name}
        description={`${projects.length} videos · started ${new Date(batch.createdAt).toLocaleString()} · about ${batch.estimatedCredits} credits`}
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/batch">New batch</Link>
          </Button>
        }
      />
      <Card className="mb-4">
        <CardContent className="grid gap-2 pt-6">
          <div className="flex justify-between text-sm">
            <span>
              <strong>{done}</strong> of {projects.length} ready{stuck ? ` · ${stuck} need you` : ''}
            </span>
            <span className="text-muted-foreground">{Math.round((done / Math.max(1, projects.length)) * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-gradient-to-r from-primary to-accent transition-all" style={{ width: `${(done / Math.max(1, projects.length)) * 100}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">Videos are made one after another in the background — you can leave this page.</p>
        </CardContent>
      </Card>
      <ul className="grid gap-2">
        {projects.map((p, i) => {
          const st = stepOf(p);
          const busy = st.tone === 'accent';
          return (
            <li key={p.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 py-3">
                  <span className="w-6 text-right text-sm tabular-nums text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.title}</p>
                    {(p.autopilot?.error || (st.tone === 'destructive' && p.lastError)) && (
                      <p className="flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {p.autopilot?.error ?? p.lastError}
                      </p>
                    )}
                  </div>
                  <Badge variant={st.tone === 'success' ? 'success' : st.tone === 'destructive' ? 'destructive' : 'accent'}>
                    {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    {st.tone === 'success' && <CheckCircle2 className="mr-1 h-3 w-3" />}
                    {st.label}
                  </Badge>
                  <Button size="sm" variant={st.tone === 'success' ? 'secondary' : 'ghost'} asChild>
                    <Link to={`/app/projects/${p.id}${st.tone === 'success' ? '/export' : ''}`}>
                      <PlayCircle /> {st.tone === 'success' ? 'Watch & download' : 'Open'}
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
