import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AudioWaveform, Coins, Film, Loader2, Minus, Pause, Play, Plus, Redo2, RotateCcw, Scissors, Shapes, Sparkles, Trash2, Type, Undo2, Wand2, ZoomIn } from 'lucide-react';
import { Button } from '../ui/button';
import { Input, Select } from '../ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Notice } from '../ui/primitives';
import { StopButton } from './ProjectActions';
import { resolveFraming } from './LivePreview';
import { FootageEdit, type FootageEditProps } from '@/motion/FootageEdit';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useAssetUrl, useBrandKit, useJob } from '@/lib/queries';
import { useAuth } from '@/features/auth/AuthProvider';
import { GRAPHIC_EMOJI } from '@/motion/graphics';
import { ICONS } from '@/motion/types';
import { captionsToOutput, graphicsToOutput, retimeCaption, keepSegments, mergeRanges, previewLines, rangeToOutput, remapWords, removedRanges, sfxToOutput, SFX_KINDS, subtractRanges, toOutput, toSource, totalLength, type EditDoc, type EditGraphic, type PoolClip, type Range, type SfxKind, type Word } from '@/features/edl';
import { cn } from '@/lib/utils';
import type { Project, ProjectSettings } from '@/types/api';

const FPS = 30;
const SIZE: Record<string, [number, number]> = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [720, 720], '4:5': [720, 900] };
const LOGO_W = { small: 0.12, medium: 0.18, large: 0.25 } as const;
/** Sound effects: names, preview link and level (same levels as the export's mix). */
const SFX_INFO: Record<SfxKind, { label: string; level: number }> = {
  whoosh: { label: 'Whoosh', level: 0.7 },
  pop: { label: 'Pop', level: 0.3 },
  impact: { label: 'Impact', level: 0.4 },
  ding: { label: 'Ding', level: 0.28 },
  tick: { label: 'Tick', level: 0.18 },
  type: { label: 'Typing', level: 0.16 },
};
const sfxUrl = (k: SfxKind) => `/api/music/sfx/${k}`;
const playSfx = (k: SfxKind, volume = 1) => {
  const a = new Audio(sfxUrl(k));
  a.volume = Math.min(1, SFX_INFO[k].level * volume * 1.4);
  void a.play().catch(() => undefined);
};
const EMOJI_CHAR: Record<(typeof GRAPHIC_EMOJI)[number], string> = {
  fire: '🔥', rocket: '🚀', idea: '💡', mind_blown: '🤯', hundred: '💯', heart_eyes: '😍', check: '✅', thumbs_up: '👍', eyes: '👀', party: '🥳', celebrate: '🎉', star: '⭐', laughing: '😂', raised_hands: '🙌', heart: '❤️',
};
const graphicName = (g: EditGraphic) => (g.kind === 'counter' ? `${g.prefix ?? ''}${g.value ?? ''}${g.suffix ?? ''}` : g.kind === 'emoji' ? `${EMOJI_CHAR[g.emoji ?? 'fire']} ${g.label ?? ''}` : (g.text ?? ''));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

type Selection = { kind: 'kept' | 'removed' | 'words'; start: number; end: number } | { kind: 'zoom'; index: number } | { kind: 'text'; index: number } | { kind: 'caption'; index: number } | { kind: 'broll'; index: number } | { kind: 'newBroll'; at: number } | { kind: 'sfx'; index: number } | { kind: 'graphic'; index: number } | null;
type Timeline = Pick<EditDoc, 'pauseSec' | 'removeFillers' | 'cuts' | 'restores' | 'zooms' | 'texts' | 'captions' | 'broll' | 'music' | 'sfx' | 'graphics'>;

/**
 * AI Video Editor "Edit" step: analyse once, then edit by hand on a timeline while a player shows the
 * real result (cuts, zooms, captions, text, logo). Every change saves automatically; the export
 * renders exactly what the player shows.
 */
export function TimelineEditor({ project, settings }: { project: Project; settings: ProjectSettings }) {
  const edit = project.edit;
  const analyzed = Boolean(edit && edit.sourceAssetId === project.sourceAssetId);
  const busy = project.status === 'queued' || project.status === 'processing';
  const job = useJob(project.id, busy);
  // While an analysis or Auto edit runs, show its progress (the timeline is rebuilt when it finishes).
  if (!analyzed || (busy && job.data?.type === 'analyze_project')) return <AnalyzeCard project={project} />;
  return <Editor key={edit!.analyzedAt} project={project} edit={edit!} settings={settings} />;
}

type Pace = 'natural' | 'fast';

/** Starts "Analyse" (edit by hand) or "Auto edit" (AI builds the whole edit), with their price. */
function useStartEdit(project: Project, enabled: boolean) {
  const estimate = useQuery({
    queryKey: ['analyze-estimate', project.id, project.sourceAssetId],
    queryFn: () => api<{ data: { credits: number; balance: number; sourceDurationSec: number } }>(`/projects/${project.id}/analyze/estimate`).then((r) => r.data),
    enabled: Boolean(project.sourceAssetId) && enabled,
  });
  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: keys.project(project.id) });
    queryClient.invalidateQueries({ queryKey: keys.job(project.id) });
    queryClient.invalidateQueries({ queryKey: keys.me });
  };
  const analyze = useMutation({ mutationFn: () => api(`/projects/${project.id}/analyze`, { method: 'POST' }), onSuccess, onError: (e) => toast.error(errorMessage(e)) });
  const auto = useMutation({ mutationFn: (pace: Pace) => api(`/projects/${project.id}/auto-edit`, { method: 'POST', body: { pace } }), onSuccess, onError: (e) => toast.error(errorMessage(e)) });
  return { estimate, analyze, auto };
}

const STAGE_LABEL: Record<string, string> = {
  transcribing: 'Transcribing speech…',
  finding_pauses: 'Finding pauses and filler words…',
  styling_captions: 'Laying out captions…',
  auto_editing: 'AI is editing: hook line, B-roll, zooms, music and sound effects…',
  saving: 'Putting it on the timeline…',
};

function AnalyzeCard({ project }: { project: Project }) {
  const busy = project.status === 'queued' || project.status === 'processing';
  const job = useJob(project.id, busy);
  const { estimate, analyze, auto } = useStartEdit(project, !busy);
  const [pace, setPace] = useState<Pace>('natural');
  const e = estimate.data;
  const cantPay = !e || e.balance < e.credits;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit your video</CardTitle>
        <CardDescription>Let AI do the whole edit in one click, or edit it yourself on a timeline. Either way you can change everything before you export.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {busy ? (
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="flex-1">
              {STAGE_LABEL[job.data?.stage ?? ''] ?? 'Analysing…'} {job.data?.progress ?? 0}%
            </span>
            <StopButton project={project} />
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid content-between gap-3 rounded-xl border-2 border-primary/50 bg-primary/5 p-4">
                <div className="grid gap-1.5">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <Wand2 className="h-4 w-4 text-primary" /> Auto edit
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Recommended</span>
                  </p>
                  <ul className="list-disc pl-5 text-sm text-muted-foreground">
                    <li>Cuts pauses and filler words</li>
                    <li>Writes a hook line for the first seconds</li>
                    <li>Word-by-word captions, key words highlighted</li>
                    <li>B-roll and zooms on key words</li>
                    <li>Music matched to the mood, sound effects on every change</li>
                  </ul>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select id="auto-pace" value={pace} onChange={(ev) => setPace(ev.target.value as Pace)} className="w-auto" aria-label="Pace">
                    <option value="natural">Natural pace</option>
                    <option value="fast">Fast-paced</option>
                  </Select>
                  <Button variant="gradient" onClick={() => auto.mutate(pace)} loading={auto.isPending} disabled={cantPay || analyze.isPending}>
                    <Wand2 /> Auto edit
                  </Button>
                </div>
              </div>
              <div className="grid content-between gap-3 rounded-xl border border-border p-4">
                <div className="grid gap-1.5">
                  <p className="flex items-center gap-2 font-semibold">
                    <Scissors className="h-4 w-4" /> Edit by hand
                  </p>
                  <p className="text-sm text-muted-foreground">AI transcribes the speech and finds every pause and filler word. Then you cut and add zooms, text, B-roll, music and sound effects yourself, watching the result as you go.</p>
                </div>
                <div>
                  <Button variant="outline" onClick={() => analyze.mutate()} loading={analyze.isPending} disabled={cantPay || auto.isPending}>
                    <Sparkles /> Analyse video
                  </Button>
                </div>
              </div>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Coins className="h-4 w-4 text-highlight" />
              {e ? (e.credits ? `Either option: ${e.credits} credits (3 per minute of footage, once) · you have ${e.balance}` : 'Free — this video was analysed before') : 'Checking the price…'}
            </p>
          </>
        )}
        {project.lastError && !busy && <Notice tone="warning">{project.lastError}</Notice>}
      </CardContent>
    </Card>
  );
}

/** Editor side panel: what Auto edit did, and running it again. */
function AutoEditCard({ project, edit, disabled }: { project: Project; edit: EditDoc; disabled: boolean }) {
  const { estimate, auto } = useStartEdit(project, true);
  const [pace, setPace] = useState<Pace>(edit.pauseSec === 0.3 ? 'fast' : 'natural');
  const a = edit.auto;
  const e = estimate.data;
  const run = () => {
    if (a && !window.confirm('Auto edit replaces the text, zooms, B-roll, music and sound effects on the timeline (your own cuts stay). Continue?')) return;
    auto.mutate(pace);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wand2 className="h-4 w-4 text-primary" /> Auto edit
        </CardTitle>
        <CardDescription>
          {a
            ? `Added ${a.hook ? `the hook “${a.hook}”${a.hookBy === 'rules' ? ' (your opening line — the AI was slow)' : ''}, ` : ''}${plural(a.counts.broll, 'B-roll clip')}, ${plural(a.counts.zooms, 'zoom')}, ${a.counts.graphics ? `${plural(a.counts.graphics, 'graphic')}, ` : ''}${plural(a.counts.sfx, 'sound effect')}${a.music ? ` and the track “${a.music}”` : ''}. Change anything on the timeline.`
            : 'Let AI build the whole edit: hook line, B-roll, zooms on key words, music and sound effects.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {a?.notes.map((n) => (
          <p key={n} className="text-xs text-muted-foreground">
            • {n}
          </p>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Select id="auto-pace-again" value={pace} onChange={(ev) => setPace(ev.target.value as Pace)} className="w-auto" aria-label="Pace">
            <option value="natural">Natural pace</option>
            <option value="fast">Fast-paced</option>
          </Select>
          <Button size="sm" variant={a ? 'outline' : 'gradient'} onClick={run} loading={auto.isPending} disabled={disabled || !e || e.balance < e.credits}>
            <Wand2 /> {a ? 'Auto edit again' : 'Auto edit'}
          </Button>
        </div>
        {e && e.credits > 0 && <p className="text-[11px] text-muted-foreground">{e.credits} credits</p>}
      </CardContent>
    </Card>
  );
}

function Editor({ project, edit, settings }: { project: Project; edit: EditDoc; settings: ProjectSettings }) {
  const duration = edit.durationSec;
  const [tl, setTl] = useState<Timeline>({ pauseSec: edit.pauseSec, removeFillers: edit.removeFillers, cuts: edit.cuts, restores: edit.restores, zooms: edit.zooms, texts: edit.texts, captions: edit.captions ?? null, broll: edit.broll ?? [], music: edit.music ?? null, sfx: edit.sfx ?? [], graphics: edit.graphics ?? [] });
  const [past, setPast] = useState<Timeline[]>([]);
  const [future, setFuture] = useState<Timeline[]>([]);
  const [sel, setSel] = useState<Selection>(null);
  const [splits, setSplits] = useState<number[]>([]);
  const [pxPerSec, setPx] = useState(60);
  const [playhead, setPlayhead] = useState(0); // source seconds
  const [playing, setPlaying] = useState(false);
  const player = useRef<PlayerRef>(null);
  const strip = useRef<HTMLDivElement>(null);

  const full: EditDoc = { ...edit, ...tl };
  const segments = useMemo(() => keepSegments(full), [tl]); // eslint-disable-line react-hooks/exhaustive-deps
  const removed = useMemo(() => removedRanges(full), [tl]); // eslint-disable-line react-hooks/exhaustive-deps
  const outLen = totalLength(segments);
  // Clips found for this project (suggestions and searches), for thumbnails and swapping.
  const [extraPool, setExtraPool] = useState<Record<string, PoolClip>>({});
  const pool = useMemo(() => ({ ...(project.edit?.brollPool ?? {}), ...extraPool }), [project.edit?.brollPool, extraPool]);

  const change = useCallback((next: Timeline | ((t: Timeline) => Timeline)) => {
    setTl((cur) => {
      const n = typeof next === 'function' ? next(cur) : next;
      setPast((p) => [...p.slice(-80), cur]);
      setFuture([]);
      return n;
    });
  }, []);
  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setFuture((f) => [tl, ...f]);
    setPast((p) => p.slice(0, -1));
    setTl(prev);
    setSel(null);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p, tl]);
    setFuture((f) => f.slice(1));
    setTl(next);
    setSel(null);
  };

  // Re-lay the captions for the current style on the server (same layout + AI highlights as analysis).
  const rebuild = useMutation({
    mutationFn: () => api<{ data: Project }>(`/projects/${project.id}/captions/rebuild`, { method: 'POST' }).then((r) => r.data),
    onSuccess: (p) => {
      change((t) => ({ ...t, captions: p.edit?.captions ?? null }));
      setSel(null);
      toast.success('Captions rebuilt');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  /* ── B-roll: AI suggestions, search, swap ── */
  const [brollAmount, setBrollAmount] = useState<'low' | 'medium' | 'high'>('medium');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PoolClip[]>([]);
  const suggest = useMutation({
    mutationFn: () => api<{ data: Project; meta: { suggested: number; plannedWith?: string } }>(`/projects/${project.id}/broll/suggest`, { method: 'POST', body: { amount: brollAmount } }),
    onSuccess: (r) => {
      queryClient.setQueryData(keys.project(project.id), r.data);
      change((t) => ({ ...t, broll: r.data.edit?.broll ?? [] }));
      setSel(null);
      toast.success(
        r.meta.suggested
          ? `${r.meta.suggested} B-roll clips suggested${r.meta.plannedWith === 'keywords' ? ' from keywords (the AI was slow)' : ''} — keep, swap or delete each one`
          : 'No closely matching stock clips were found for what you say',
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const suggestGraphics = useMutation({
    mutationFn: () => api<{ data: Project; meta: { suggested: number; plannedWith?: string } }>(`/projects/${project.id}/graphics/suggest`, { method: 'POST' }),
    onSuccess: (r) => {
      queryClient.setQueryData(keys.project(project.id), r.data);
      change((t) => ({ ...t, graphics: r.data.edit?.graphics ?? [] }));
      setSel(null);
      toast.success(r.meta.suggested ? `${r.meta.suggested} graphics added${r.meta.plannedWith === 'rules' ? ' from your words (the AI was slow)' : ''} — click one to change it` : 'No good moments for graphics were found');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const search = useMutation({
    mutationFn: (q: string) => api<{ data: { clips: PoolClip[] } }>(`/projects/${project.id}/broll/search`, { method: 'POST', body: { query: q } }).then((r) => r.data.clips),
    onSuccess: (clips) => {
      setResults(clips);
      setExtraPool((p) => ({ ...p, ...Object.fromEntries(clips.map((c) => [c.id, c])) }));
      if (!clips.length) toast.info('No clips found — try different words');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  /** Puts a clip in the selected B-roll slot, or creates a new slot at the playhead. */
  const placeClip = (clip: PoolClip) => {
    const list = tl.broll ?? [];
    if (sel?.kind === 'broll') {
      change((t) => ({ ...t, broll: list.map((b, i) => (i === sel.index ? { ...b, clipId: clip.id, query: query.trim() || b.query, candidateIds: [...new Set([clip.id, ...b.candidateIds])].slice(0, 12) } : b)) }));
    } else if (sel?.kind === 'newBroll') {
      const start = Math.round(sel.at * 100) / 100;
      const item = { start, end: Math.min(duration, start + Math.min(4, Math.max(1.5, clip.durationSec || 3))), query: query.trim(), clipId: clip.id, candidateIds: [clip.id] };
      const next = [...list, item].sort((a, b) => a.start - b.start);
      change((t) => ({ ...t, broll: next }));
      setSel({ kind: 'broll', index: next.indexOf(item) });
    }
  };
  const tracks = useMusicLibrary();

  // Auto-save (debounced) whenever the timeline changes.
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      // Older analyses have no saved segments yet: save the computed ones so the export matches.
      if (edit.segments.length) return;
    }
    setSaveState('saving');
    const h = setTimeout(() => {
      api<{ data: Project }>(`/projects/${project.id}/edit`, { method: 'PATCH', body: { ...tl, segments } })
        .then((r) => {
          queryClient.setQueryData(keys.project(project.id), r.data);
          queryClient.invalidateQueries({ queryKey: keys.estimate(project.id) });
          setSaveState('saved');
        })
        .catch((e) => {
          setSaveState('error');
          toast.error(errorMessage(e));
        });
    }, 700);
    return () => clearTimeout(h);
  }, [tl]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Player inputs ── */
  const { inputProps, words, src, W, H } = useFootageInput(project, settings, segments, tl.zooms, tl.texts, tl.captions, tl.broll, pool, tl.music, tl.sfx, tl.graphics);

  // Keep the playhead (source time) in sync with the player.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setPlayhead(toSource(segments, e.detail.frame / FPS));
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
    };
  }, [segments, src.data]);

  const seekSource = (t: number) => {
    const clamped = Math.max(0, Math.min(duration, t));
    setPlayhead(clamped);
    // A cut moment plays from the next kept moment.
    const next = segments.find((s) => s.end > clamped);
    const out = toOutput(segments, Math.max(clamped, next ? next.start : clamped));
    if (out !== null) player.current?.seekTo(Math.round(out * FPS));
  };

  /* ── Pieces you can select on the video track ── */
  const pieces = useMemo(() => {
    const cuts = [...splits].sort((a, b) => a - b);
    const kept = segments.flatMap((s) => {
      const inner = cuts.filter((c) => c > s.start + 0.05 && c < s.end - 0.05);
      const edges = [s.start, ...inner, s.end];
      return edges.slice(0, -1).map((a, i) => ({ start: a, end: edges[i + 1]!, kind: 'kept' as const }));
    });
    const gone = subtractRanges([{ start: 0, end: duration }], segments).map((r) => ({ ...r, kind: 'removed' as const }));
    return [...kept, ...gone].sort((a, b) => a.start - b.start);
  }, [segments, splits, duration]);

  const removeRange = (r: Range) => {
    change((t) => ({ ...t, cuts: mergeRanges([...t.cuts, r]), restores: subtractRanges(mergeRanges(t.restores), [r]) }));
    setSel(null);
  };
  const restoreRange = (r: Range) => {
    change((t) => ({ ...t, restores: mergeRanges([...t.restores, r]), cuts: subtractRanges(mergeRanges(t.cuts), [r]) }));
    setSel(null);
  };
  const split = () => {
    if (!segments.some((s) => playhead > s.start + 0.05 && playhead < s.end - 0.05)) return toast.info('Move the playhead onto a kept part of the video to split it.');
    setSplits((s) => [...s, Math.round(playhead * 1000) / 1000]);
    toast.success('Split — click a piece and press Delete to cut it');
  };
  const deleteSel = () => {
    if (!sel) return;
    if (sel.kind === 'kept' || sel.kind === 'words') removeRange({ start: sel.start, end: sel.end });
    else if (sel.kind === 'removed') restoreRange({ start: sel.start, end: sel.end });
    else if (sel.kind === 'zoom') change((t) => ({ ...t, zooms: t.zooms.filter((_, i) => i !== sel.index) }));
    else if (sel.kind === 'text') change((t) => ({ ...t, texts: t.texts.filter((_, i) => i !== sel.index) }));
    else if (sel.kind === 'caption') change((t) => ({ ...t, captions: (t.captions ?? []).filter((_, i) => i !== sel.index) }));
    else if (sel.kind === 'broll') change((t) => ({ ...t, broll: (t.broll ?? []).filter((_, i) => i !== sel.index) }));
    else if (sel.kind === 'graphic') change((t) => ({ ...t, graphics: (t.graphics ?? []).filter((_, i) => i !== sel.index) }));
    else if (sel.kind === 'sfx') change((t) => ({ ...t, sfx: (t.sfx ?? []).filter((_, i) => i !== sel.index) }));
    setSel(null);
  };
  const addZoom = () => {
    change((t) => ({ ...t, zooms: [...t.zooms, { at: Math.round(playhead * 100) / 100, dur: 1.5, scale: 1.12 }].sort((a, b) => a.at - b.at) }));
  };
  const addSfx = () => {
    const item = { at: Math.round(playhead * 100) / 100, kind: 'whoosh' as SfxKind };
    const next = [...(tl.sfx ?? []), item].sort((a, b) => a.at - b.at);
    change((t) => ({ ...t, sfx: next }));
    setSel({ kind: 'sfx', index: next.indexOf(item) });
    playSfx('whoosh');
  };
  const setSfx = (index: number, patch: Partial<NonNullable<Timeline['sfx']>[number]>) => change((t) => ({ ...t, sfx: (t.sfx ?? []).map((x, i) => (i === index ? { ...x, ...patch } : x)) }));
  const addGraphic = () => {
    const start = Math.round(playhead * 100) / 100;
    const item: EditGraphic = { start, end: Math.min(duration, start + 2.5), kind: 'counter', value: 100, suffix: '%', label: 'Your label', position: 'middle' };
    if (item.end - item.start < 0.8) return toast.info('Move the playhead earlier — a graphic needs at least 0.8 s.');
    const next = [...(tl.graphics ?? []), item].sort((a, b) => a.start - b.start);
    change((t) => ({ ...t, graphics: next }));
    setSel({ kind: 'graphic', index: next.indexOf(item) });
  };
  const setGraphic = (index: number, patch: Partial<EditGraphic>) => change((t) => ({ ...t, graphics: (t.graphics ?? []).map((x, i) => (i === index ? { ...x, ...patch } : x)) }));
  const addText = () => {
    const start = Math.round(playhead * 100) / 100;
    change((t) => ({ ...t, texts: [...t.texts, { start, end: Math.min(duration, start + 2.5), text: 'Your text here', position: 'top' as const }] }));
    setSel({ kind: 'text', index: tl.texts.length });
  };
  const togglePlay = () => (playing ? player.current?.pause() : player.current?.play());

  // Keyboard: Space play/pause, S split, Delete/Backspace remove, Ctrl+Z / Ctrl+Shift+Z.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 's' || e.key === 'S') split();
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSel();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pauseCount = edit.silences.filter((s) => tl.pauseSec > 0 && s.end - s.start >= tl.pauseSec).length;
  const width = Math.max(600, duration * pxPerSec);
  const x = (t: number) => t * pxPerSec;
  const selText = sel?.kind === 'text' ? tl.texts[sel.index] : null;
  const selZoom = sel?.kind === 'zoom' ? tl.zooms[sel.index] : null;
  const selSfx = sel?.kind === 'sfx' ? tl.sfx?.[sel.index] : null;
  const selGraphic = sel?.kind === 'graphic' ? tl.graphics?.[sel.index] : null;
  const selCaption = sel?.kind === 'caption' ? tl.captions?.[sel.index] : null;
  const setText = (index: number, patch: Partial<Timeline['texts'][number]>) => change((t) => ({ ...t, texts: t.texts.map((x, i) => (i === index ? { ...x, ...patch } : x)) }));
  const setCaption = (index: number, next: NonNullable<Timeline['captions']>[number]) => change((t) => ({ ...t, captions: (t.captions ?? []).map((c, i) => (i === index ? next : c)) }));
  const isRemoved = (w: Word) => removed.some((r) => w.start >= r.start - 0.01 && w.end <= r.end + 0.01);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardContent className="grid gap-3 pt-6">
            <div className="mx-auto w-full overflow-hidden rounded-lg bg-black" style={{ maxWidth: W > H ? 720 : 340 }}>
              {src.data && segments.length ? (
                <Player
                  ref={player}
                  component={FootageEdit}
                  inputProps={inputProps}
                  durationInFrames={Math.max(1, Math.round(outLen * FPS))}
                  fps={FPS}
                  compositionWidth={W}
                  compositionHeight={H}
                  style={{ width: '100%', aspectRatio: `${W} / ${H}` }}
                  controls
                  clickToPlay
                  acknowledgeRemotionLicense
                />
              ) : (
                <div className="grid place-items-center text-sm text-muted-foreground" style={{ aspectRatio: `${W} / ${H}` }}>
                  {segments.length ? 'Loading your video…' : 'Everything is cut — undo or restore something.'}
                </div>
              )}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {fmt(duration)} → <strong className="text-foreground">{fmt(outLen)}</strong> · {pauseCount} pauses{tl.removeFillers ? ` and ${edit.fillers.length} filler words` : ''} removed
              {' · '}
              {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'Saved'}
            </p>
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <AutoEditCard project={project} edit={edit} disabled={saveState === 'saving'} />
          {selSfx && sel?.kind === 'sfx' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sound effect</CardTitle>
                <CardDescription>At {fmt(selSfx.at)}. Click a sound to hear it.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Sound">
                  {SFX_KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={selSfx.kind === k}
                      onClick={() => {
                        setSfx(sel.index, { kind: k });
                        playSfx(k, selSfx.volume ?? 1);
                      }}
                      className={cn('rounded-md border px-2 py-1.5 text-xs font-medium', selSfx.kind === k ? 'border-highlight bg-highlight/15 ring-1 ring-highlight' : 'border-border hover:border-primary/50')}
                    >
                      {SFX_INFO[k].label}
                    </button>
                  ))}
                </div>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Volume: {Math.round((selSfx.volume ?? 1) * 100)}%
                  <input
                    id="sfx-volume"
                    type="range"
                    min={0}
                    max={150}
                    step={10}
                    value={Math.round((selSfx.volume ?? 1) * 100)}
                    onChange={(ev) => setSfx(sel.index, { volume: Number(ev.target.value) / 100 })}
                    onMouseUp={() => playSfx(selSfx.kind, selSfx.volume ?? 1)}
                    className="accent-[hsl(var(--primary))]"
                  />
                </label>
                <Button variant="outline" size="sm" onClick={deleteSel}>
                  <Trash2 /> Remove sound
                </Button>
              </CardContent>
            </Card>
          )}
          {selGraphic && sel?.kind === 'graphic' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Graphic</CardTitle>
                <CardDescription>Shown from {fmt(selGraphic.start)} for {Math.round((selGraphic.end - selGraphic.start) * 10) / 10} s.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Graphic type">
                  {(['counter', 'emoji', 'callout'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={selGraphic.kind === k}
                      onClick={() => setGraphic(sel.index, { kind: k, ...(k === 'counter' && selGraphic.value === undefined ? { value: 100, suffix: '%' } : {}), ...(k === 'emoji' && !selGraphic.emoji ? { emoji: 'fire' as const } : {}), ...(k === 'callout' && !selGraphic.text ? { text: 'Key point', heading: 'Tip' } : {}) })}
                      className={cn('rounded-md border px-2 py-1.5 text-xs font-medium', selGraphic.kind === k ? 'border-highlight bg-highlight/15 ring-1 ring-highlight' : 'border-border hover:border-primary/50')}
                    >
                      {k === 'counter' ? 'Number' : k === 'emoji' ? 'Emoji' : 'Callout'}
                    </button>
                  ))}
                </div>
                {selGraphic.kind === 'counter' && (
                  <div className="grid grid-cols-[64px_1fr_72px] gap-1.5">
                    <Input id="graphic-prefix" placeholder="₹" maxLength={4} value={selGraphic.prefix ?? ''} onChange={(ev) => setGraphic(sel.index, { prefix: ev.target.value || undefined })} aria-label="Before the number" />
                    <Input id="graphic-value" type="number" value={selGraphic.value ?? 0} onChange={(ev) => setGraphic(sel.index, { value: Number(ev.target.value) || 0 })} aria-label="Number" />
                    <Input id="graphic-suffix" placeholder="%" maxLength={10} value={selGraphic.suffix ?? ''} onChange={(ev) => setGraphic(sel.index, { suffix: ev.target.value || undefined })} aria-label="After the number" />
                  </div>
                )}
                {selGraphic.kind === 'emoji' && (
                  <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label="Emoji">
                    {GRAPHIC_EMOJI.map((e) => (
                      <button key={e} type="button" role="radio" aria-checked={selGraphic.emoji === e} onClick={() => setGraphic(sel.index, { emoji: e })} className={cn('rounded-md border py-1 text-lg', selGraphic.emoji === e ? 'border-highlight bg-highlight/15' : 'border-border hover:border-primary/50')} title={e.replace(/_/g, ' ')}>
                        {EMOJI_CHAR[e]}
                      </button>
                    ))}
                  </div>
                )}
                {selGraphic.kind === 'callout' && (
                  <>
                    <Input id="graphic-text" maxLength={70} value={selGraphic.text ?? ''} onChange={(ev) => setGraphic(sel.index, { text: ev.target.value })} aria-label="Callout text" placeholder="Key point" />
                    <div className="grid grid-cols-2 gap-1.5">
                      <Input id="graphic-heading" maxLength={24} value={selGraphic.heading ?? ''} onChange={(ev) => setGraphic(sel.index, { heading: ev.target.value || undefined })} aria-label="Small heading" placeholder="Heading (optional)" />
                      <Select id="graphic-icon" value={selGraphic.icon ?? ''} onChange={(ev) => setGraphic(sel.index, { icon: (ev.target.value || undefined) as EditGraphic['icon'] })} aria-label="Icon">
                        <option value="">No icon</option>
                        {ICONS.map((i) => (
                          <option key={i} value={i}>
                            {i}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </>
                )}
                {selGraphic.kind !== 'callout' && (
                  <Input id="graphic-label" maxLength={40} value={selGraphic.label ?? ''} onChange={(ev) => setGraphic(sel.index, { label: ev.target.value || undefined })} aria-label="Label" placeholder="Label (optional)" />
                )}
                <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <Select id="graphic-position" value={selGraphic.position} onChange={(ev) => setGraphic(sel.index, { position: ev.target.value as EditGraphic['position'] })} aria-label="Position">
                    <option value="top">Top</option>
                    <option value="middle">Middle</option>
                    <option value="bottom">Above the captions</option>
                  </Select>
                  <input type="color" aria-label="Accent colour" className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent" value={selGraphic.color ?? settings.highlightColor ?? '#A78BFA'} onChange={(ev) => setGraphic(sel.index, { color: ev.target.value })} />
                </div>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Shows for (seconds)
                  <Input id="graphic-length" type="number" min={0.8} max={8} step={0.5} value={Math.round((selGraphic.end - selGraphic.start) * 10) / 10} onChange={(ev) => setGraphic(sel.index, { end: Math.min(duration, selGraphic.start + Math.min(8, Math.max(0.8, Number(ev.target.value) || 0.8))) })} />
                </label>
                <Button variant="outline" size="sm" onClick={deleteSel}>
                  <Trash2 /> Remove graphic
                </Button>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Motion graphics</CardTitle>
              <CardDescription>AI adds animated numbers for stats you say, emoji reactions and callout cards for key points. Click one on the timeline to change it.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" onClick={() => suggestGraphics.mutate()} loading={suggestGraphics.isPending}>
                <Shapes /> {tl.graphics?.length ? 'Suggest again' : 'Suggest graphics'}
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Automatic cuts</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Remove pauses longer than</span>
                <Select id="pause-sec" value={String(tl.pauseSec)} onChange={(e) => change((t) => ({ ...t, pauseSec: Number(e.target.value) as Timeline['pauseSec'] }))}>
                  <option value="0">Off (keep all pauses)</option>
                  <option value="1">1 second</option>
                  <option value="0.6">0.6 seconds (natural)</option>
                  <option value="0.3">0.3 seconds (fast-paced)</option>
                </Select>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input id="remove-fillers" type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={tl.removeFillers} onChange={(e) => change((t) => ({ ...t, removeFillers: e.target.checked }))} />
                <span>
                  Remove filler words
                  <span className="block text-xs text-muted-foreground">“um”, “uh”… ({edit.fillers.length} found)</span>
                </span>
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Captions</CardTitle>
              <CardDescription>
                {tl.captions?.length ? `${tl.captions.length} lines. Click one on the timeline to change its words or highlighted word.` : 'Captions are made from the transcript.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" onClick={() => rebuild.mutate()} loading={rebuild.isPending} title="Lay the captions out again for the current caption style (your caption edits are replaced)">
                <RotateCcw /> {tl.captions?.length ? 'Rebuild for current style' : 'Make captions'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">B-roll</CardTitle>
              <CardDescription>AI picks moments that need a visual and finds stock clips for each. You keep, swap or delete every clip — nothing is added that you don’t see on the timeline.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Select id="broll-amount" value={brollAmount} onChange={(e) => setBrollAmount(e.target.value as 'medium')} className="w-auto">
                <option value="low">A few</option>
                <option value="medium">Some</option>
                <option value="high">Lots</option>
              </Select>
              <Button variant="outline" size="sm" onClick={() => suggest.mutate()} loading={suggest.isPending} title={(tl.broll?.length ?? 0) ? 'Replaces the current B-roll' : undefined}>
                <Sparkles /> {(tl.broll?.length ?? 0) ? 'Suggest again' : 'Suggest B-roll'}
              </Button>
            </CardContent>
          </Card>

          {(sel?.kind === 'broll' || sel?.kind === 'newBroll') && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{sel.kind === 'newBroll' ? `New B-roll at ${fmt(sel.at)}` : 'B-roll clip'}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {sel.kind === 'broll' && tl.broll?.[sel.index] && (() => {
                  const b = tl.broll[sel.index]!;
                  return (
                    <>
                      <span className="text-xs text-muted-foreground">Options for this moment</span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {b.candidateIds.map((id) => pool[id]).filter(Boolean).map((c) => (
                          <button key={c!.id} type="button" onClick={() => placeClip(c!)} className={cn('aspect-video overflow-hidden rounded-md border bg-muted bg-cover bg-center', c!.id === b.clipId ? 'border-highlight ring-2 ring-highlight' : 'border-border hover:border-primary/50')} style={{ backgroundImage: c!.thumbnailUrl ? `url("${c!.thumbnailUrl}")` : undefined }} aria-label={`Use clip by ${c!.author}`} />
                        ))}
                      </div>
                      <label className="grid gap-1 text-xs text-muted-foreground">
                        Shows for (seconds)
                        <Input id="broll-length" type="number" min={0.5} max={12} step={0.5} value={Math.round((b.end - b.start) * 10) / 10} onChange={(e) => change((t) => ({ ...t, broll: (t.broll ?? []).map((x, i) => (i === sel.index ? { ...x, end: Math.min(duration, x.start + Math.min(12, Math.max(0.5, Number(e.target.value) || 0.5))) } : x)) }))} />
                      </label>
                    </>
                  );
                })()}
                <form
                  className="flex gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (query.trim().length >= 2) search.mutate(query.trim());
                  }}
                >
                  <Input id="broll-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stock clips, e.g. city at night" maxLength={60} />
                  <Button type="submit" size="sm" variant="secondary" loading={search.isPending}>
                    Search
                  </Button>
                </form>
                {results.length > 0 && (
                  <div className="grid grid-cols-2 gap-1.5">
                    {results.map((c) => (
                      <button key={c.id} type="button" onClick={() => placeClip(c)} className="aspect-video overflow-hidden rounded-md border border-border bg-muted bg-cover bg-center hover:border-primary/50" style={{ backgroundImage: c.thumbnailUrl ? `url("${c.thumbnailUrl}")` : undefined }} aria-label={`Use clip by ${c.author}`} title={`${c.author} · ${Math.round(c.durationSec)} s`} />
                    ))}
                  </div>
                )}
                {sel.kind === 'broll' && (
                  <Button variant="outline" size="sm" onClick={deleteSel}>
                    <Trash2 /> Remove clip
                  </Button>
                )}
                <p className="text-[11px] text-muted-foreground">Stock clips from Pixabay, credited in the finished video. The preview shows a still; the export uses the moving clip.</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Music</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Select
                id="music-track"
                value={tl.music?.mode === 'track' ? tl.music.file : (tl.music?.mode ?? 'auto')}
                onChange={(e) => {
                  const v = e.target.value;
                  const base = { volume: tl.music?.volume ?? 0.25, duck: tl.music?.duck ?? true };
                  change((t) => ({ ...t, music: v === 'auto' || v === 'none' ? { ...base, mode: v } : { ...base, mode: 'track', file: v } }));
                }}
              >
                <option value="auto">Match the style (automatic)</option>
                <option value="none">No music</option>
                {tracks.map((t) => (
                  <option key={t.file} value={t.file}>
                    {t.title} — {t.artist} ({t.moods.join(', ')})
                  </option>
                ))}
              </Select>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Volume: {Math.round((tl.music?.volume ?? 0.25) * 100)}%
                <input
                  id="music-volume"
                  type="range"
                  min={0}
                  max={60}
                  step={5}
                  value={Math.round((tl.music?.volume ?? 0.25) * 100)}
                  onChange={(e) => change((t) => ({ ...t, music: { mode: t.music?.mode ?? 'auto', file: t.music?.file, duck: t.music?.duck ?? true, volume: Number(e.target.value) / 100 } }))}
                  className="accent-[hsl(var(--primary))]"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input id="music-duck" type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={tl.music?.duck ?? true} onChange={(e) => change((t) => ({ ...t, music: { mode: t.music?.mode ?? 'auto', file: t.music?.file, volume: t.music?.volume ?? 0.25, duck: e.target.checked } }))} />
                Lower the music while you speak
              </label>
              {!tracks.length && <p className="text-xs text-muted-foreground">No music in the library yet — an admin adds Pixabay tracks in Admin → Music library.</p>}
            </CardContent>
          </Card>

          {selCaption && sel?.kind === 'caption' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Caption line</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Input
                  id="caption-text"
                  defaultValue={selCaption.words.map((w) => w.text).join(' ')}
                  key={`${sel.index}-${selCaption.words.length}`}
                  maxLength={160}
                  onBlur={(e) => {
                    const text = e.target.value.trim();
                    if (text && text !== selCaption.words.map((w) => w.text).join(' ')) setCaption(sel.index, retimeCaption(selCaption, text));
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <div className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">Highlighted word</span>
                  <div className="flex flex-wrap gap-1.5">
                    {selCaption.words.map((w, k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setCaption(sel.index, { ...selCaption, keyword: selCaption.keyword === k ? -1 : k })}
                        className={cn('rounded-md border px-2 py-1 text-xs', selCaption.keyword === k ? 'border-highlight bg-highlight/20 font-semibold' : 'border-border hover:border-primary/40')}
                      >
                        {w.text}
                      </button>
                    ))}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={deleteSel}>
                  <Trash2 /> Hide this caption
                </Button>
              </CardContent>
            </Card>
          )}

          {selText && sel?.kind === 'text' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Text overlay</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Input id="text-overlay" value={selText.text} maxLength={80} onChange={(e) => change((t) => ({ ...t, texts: t.texts.map((x, i) => (i === sel.index ? { ...x, text: e.target.value } : x)) }))} />
                <Select id="text-position" value={selText.position} onChange={(e) => change((t) => ({ ...t, texts: t.texts.map((x, i) => (i === sel.index ? { ...x, position: e.target.value as 'top' } : x)) }))}>
                  <option value="top">Top</option>
                  <option value="middle">Middle</option>
                  <option value="bottom">Bottom</option>
                </Select>
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Text style">
                  {([
                    ['outline', 'Outline'],
                    ['box', 'Dark box'],
                    ['accent', 'Colour box'],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={(selText.style ?? 'outline') === id}
                      onClick={() => setText(sel.index, { style: id })}
                      className={cn('rounded-md border px-2 py-1.5 text-xs', (selText.style ?? 'outline') === id ? 'border-primary bg-primary/15 font-semibold' : 'border-border hover:border-primary/40')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Select id="text-size" value={selText.size ?? 'm'} onChange={(e) => setText(sel.index, { size: e.target.value as 'm' })}>
                    <option value="s">Small</option>
                    <option value="m">Medium</option>
                    <option value="l">Large</option>
                  </Select>
                  <input
                    id="text-color"
                    type="color"
                    aria-label={(selText.style ?? 'outline') === 'accent' ? 'Box colour' : 'Text colour'}
                    title={(selText.style ?? 'outline') === 'accent' ? 'Box colour' : 'Text colour'}
                    disabled={selText.style === 'box'}
                    value={selText.color ?? (selText.style === 'accent' ? '#7C3AED' : '#FFFFFF')}
                    onChange={(e) => setText(sel.index, { color: e.target.value.toUpperCase() })}
                    className="h-9 w-12 shrink-0 cursor-pointer rounded border border-border bg-transparent disabled:opacity-40"
                  />
                </div>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Shows for (seconds)
                  <Input id="text-length" type="number" min={0.5} max={15} step={0.5} value={Math.round((selText.end - selText.start) * 10) / 10} onChange={(e) => change((t) => ({ ...t, texts: t.texts.map((x, i) => (i === sel.index ? { ...x, end: Math.min(duration, x.start + Math.max(0.5, Number(e.target.value) || 0.5)) } : x)) }))} />
                </label>
                <Button variant="outline" size="sm" onClick={deleteSel}>
                  <Trash2 /> Remove text
                </Button>
              </CardContent>
            </Card>
          )}
          {selZoom && sel?.kind === 'zoom' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Zoom</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Select id="zoom-scale" value={String(selZoom.scale)} onChange={(e) => change((t) => ({ ...t, zooms: t.zooms.map((z, i) => (i === sel.index ? { ...z, scale: Number(e.target.value) } : z)) }))}>
                  <option value="1.08">Subtle (8%)</option>
                  <option value="1.12">Medium (12%)</option>
                  <option value="1.2">Strong (20%)</option>
                  <option value="1.3">Punchy (30%)</option>
                </Select>
                <Select id="zoom-length" value={String(selZoom.dur)} onChange={(e) => change((t) => ({ ...t, zooms: t.zooms.map((z, i) => (i === sel.index ? { ...z, dur: Number(e.target.value) } : z)) }))}>
                  <option value="0.8">0.8 s</option>
                  <option value="1.5">1.5 s</option>
                  <option value="2.5">2.5 s</option>
                  <option value="4">4 s</option>
                </Select>
                <Button variant="outline" size="sm" onClick={deleteSel}>
                  <Trash2 /> Remove zoom
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause /> : <Play />}
            </Button>
            <span className="mr-2 font-mono text-xs tabular-nums text-muted-foreground">{fmt(playhead)}</span>
            <Button size="sm" variant="outline" onClick={split} title="Split at the playhead (S)">
              <Scissors /> Split
            </Button>
            <Button size="sm" variant="outline" onClick={deleteSel} disabled={!sel} title="Delete or restore the selection (Delete)">
              {sel?.kind === 'removed' ? <RotateCcw /> : <Trash2 />} {sel?.kind === 'removed' ? 'Restore' : 'Delete'}
            </Button>
            <Button size="sm" variant="outline" onClick={addZoom} title="Add a punch-in zoom at the playhead">
              <ZoomIn /> Zoom
            </Button>
            <Button size="sm" variant="outline" onClick={addText} title="Add text at the playhead">
              <Type /> Text
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSel({ kind: 'newBroll', at: playhead });
                setResults([]);
                setQuery('');
              }}
              title="Add a stock clip at the playhead"
            >
              <Film /> B-roll
            </Button>
            <Button size="sm" variant="outline" onClick={addSfx} title="Add a sound effect at the playhead">
              <AudioWaveform /> Sound
            </Button>
            <Button size="sm" variant="outline" onClick={addGraphic} title="Add a motion graphic at the playhead">
              <Shapes /> Graphic
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button size="sm" variant="ghost" onClick={undo} disabled={!past.length} aria-label="Undo (Ctrl+Z)">
              <Undo2 />
            </Button>
            <Button size="sm" variant="ghost" onClick={redo} disabled={!future.length} aria-label="Redo (Ctrl+Shift+Z)">
              <Redo2 />
            </Button>
            <span className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setPx((p) => Math.max(15, p / 1.5))} aria-label="Zoom timeline out">
                <Minus />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPx((p) => Math.min(400, p * 1.5))} aria-label="Zoom timeline in">
                <Plus />
              </Button>
            </span>
          </div>

          <div ref={strip} className="overflow-x-auto rounded-lg border border-border bg-muted/30">
            <div
              className="relative select-none"
              style={{ width, height: 330 }}
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).dataset.track !== 'ruler') return;
                const rect = e.currentTarget.getBoundingClientRect();
                seekSource((e.clientX - rect.left) / pxPerSec);
              }}
            >
              {/* Ruler */}
              <div data-track="ruler" className="absolute inset-x-0 top-0 h-6 cursor-pointer border-b border-border">
                {Array.from({ length: Math.ceil(duration) + 1 }, (_, s) => s)
                  .filter((s) => pxPerSec >= 40 || s % 5 === 0)
                  .map((s) => (
                    <span key={s} data-track="ruler" className="absolute top-0 h-full border-l border-border pl-1 text-[10px] text-muted-foreground" style={{ left: x(s) }}>
                      {fmt(s).replace(/\.0$/, '')}
                    </span>
                  ))}
              </div>
              {/* Video track */}
              <TrackLabel top={28} label="Video" />
              {pieces.map((p) => {
                const active = sel && (sel.kind === 'kept' || sel.kind === 'removed') && sel.start === p.start && sel.end === p.end;
                return (
                  <button
                    key={`${p.kind}-${p.start}`}
                    type="button"
                    title={p.kind === 'kept' ? `Kept ${fmt(p.start)}–${fmt(p.end)} · click, then Delete to cut` : `Cut ${fmt(p.start)}–${fmt(p.end)} · click, then Restore`}
                    onClick={() => {
                      setSel({ kind: p.kind, start: p.start, end: p.end });
                      seekSource(p.start);
                    }}
                    className={cn(
                      'absolute top-7 h-10 rounded-sm border text-[10px]',
                      p.kind === 'kept' ? 'border-primary/60 bg-primary/30 hover:bg-primary/40' : 'border-dashed border-muted-foreground/40 bg-[repeating-linear-gradient(45deg,transparent_0_4px,hsl(var(--muted-foreground)/0.18)_4px_8px)]',
                      active && 'ring-2 ring-highlight',
                    )}
                    style={{ left: x(p.start), width: Math.max(2, x(p.end) - x(p.start)) }}
                  />
                );
              })}
              {/* Words */}
              {/* Captions */}
              <TrackLabel top={72} label="Captions" />
              {(tl.captions ?? []).map((c, i) => {
                const start = c.words[0]!.start;
                const end = c.words[c.words.length - 1]!.end;
                const cut = !rangeToOutput(segments, start, end);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setSel({ kind: 'caption', index: i });
                      seekSource(start);
                    }}
                    title={`${c.words.map((w) => w.text).join(' ')} · click to edit`}
                    className={cn(
                      'absolute top-[70px] h-7 overflow-hidden whitespace-nowrap rounded-sm border px-1 text-left text-[10px] leading-7',
                      cut ? 'border-dashed border-muted-foreground/40 text-muted-foreground opacity-50' : 'border-amber-400/60 bg-amber-400/20 text-foreground',
                      sel?.kind === 'caption' && sel.index === i && 'ring-2 ring-highlight',
                    )}
                    style={{ left: x(start), width: Math.max(10, x(end) - x(start) - 1) }}
                  >
                    {c.words.map((w, k) => (
                      <span key={k} className={k === c.keyword ? 'font-bold text-highlight' : undefined}>
                        {w.text}{' '}
                      </span>
                    ))}
                  </button>
                );
              })}
              <TrackLabel top={104} label="Words" />
              {words.map((w, i) => {
                const gone = isRemoved(w) || (w.filler && tl.removeFillers);
                const inSel = sel?.kind === 'words' && w.start >= sel.start - 0.001 && w.end <= sel.end + 0.001;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={(e) => {
                      if (e.shiftKey && sel?.kind === 'words') setSel({ kind: 'words', start: Math.min(sel.start, w.start), end: Math.max(sel.end, w.end) });
                      else setSel({ kind: 'words', start: w.start, end: w.end });
                      seekSource(w.start);
                    }}
                    title={`${w.text} · click to select (Shift+click to extend), Delete to cut`}
                    className={cn('absolute top-[102px] h-7 overflow-hidden whitespace-nowrap rounded-sm px-0.5 text-left text-[10px] leading-7', gone ? 'text-muted-foreground line-through opacity-50' : 'bg-card text-foreground', w.filler && 'italic text-warning', inSel && 'bg-highlight/30 ring-1 ring-highlight')}
                    style={{ left: x(w.start), width: Math.max(4, x(w.end) - x(w.start) - 1) }}
                  >
                    {w.text}
                  </button>
                );
              })}
              {/* Zooms */}
              {/* B-roll */}
              <TrackLabel top={138} label="B-roll" />
              {(tl.broll ?? []).map((b, i) => {
                const clip = pool[b.clipId];
                return (
                  <button
                    key={`${b.clipId}-${i}`}
                    type="button"
                    onClick={() => {
                      setSel({ kind: 'broll', index: i });
                      setQuery(b.query);
                      setResults([]);
                      seekSource(b.start);
                    }}
                    title={`B-roll “${b.query}” · ${fmt(b.start)}–${fmt(b.end)} · click to swap or delete`}
                    className={cn('absolute top-[136px] h-8 overflow-hidden rounded-sm border border-sky-400/60 bg-sky-400/20 bg-cover bg-center', sel?.kind === 'broll' && sel.index === i && 'ring-2 ring-highlight')}
                    style={{ left: x(b.start), width: Math.max(14, x(b.end) - x(b.start)), backgroundImage: clip?.thumbnailUrl ? `url("${clip.thumbnailUrl}")` : undefined }}
                  >
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 text-[9px] text-white">{b.query}</span>
                  </button>
                );
              })}
              <TrackLabel top={170} label="Zoom" />
              {tl.zooms.map((z, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setSel({ kind: 'zoom', index: i });
                    seekSource(z.at);
                  }}
                  title={`Zoom ${Math.round((z.scale - 1) * 100)}% for ${z.dur}s`}
                  className={cn('absolute top-[170px] h-6 rounded-sm border border-accent/60 bg-accent/30', sel?.kind === 'zoom' && sel.index === i && 'ring-2 ring-highlight')}
                  style={{ left: x(z.at), width: Math.max(8, z.dur * pxPerSec) }}
                />
              ))}
              {/* Text */}
              <TrackLabel top={198} label="Text" />
              {tl.texts.map((t, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setSel({ kind: 'text', index: i });
                    seekSource(t.start);
                  }}
                  className={cn('absolute top-[198px] h-7 overflow-hidden whitespace-nowrap rounded-sm border border-success/60 bg-success/20 px-1 text-left text-[10px] leading-7', sel?.kind === 'text' && sel.index === i && 'ring-2 ring-highlight')}
                  style={{ left: x(t.start), width: Math.max(12, x(t.end) - x(t.start)) }}
                >
                  {t.text}
                </button>
              ))}
              {/* Music */}
              <TrackLabel top={230} label="Music" />
              {(() => {
                const t = musicTrackFor(tl.music ?? null, tracks, settings.musicMood, project.style, project.id);
                return (
                  <div className="absolute top-[228px] h-7 overflow-hidden whitespace-nowrap rounded-sm border border-fuchsia-400/50 bg-fuchsia-400/15 px-2 text-[10px] leading-7 text-foreground" style={{ left: 0, width: x(duration) }}>
                    {t ? `♪ ${t.title} — ${t.artist} · volume ${Math.round((tl.music?.volume ?? 0.25) * 100)}%${(tl.music?.duck ?? true) ? ' · dips while you speak' : ''}` : tracks.length ? 'No music' : 'No music in the library yet'}
                  </div>
                );
              })()}
              {/* Sound effects */}
              <TrackLabel top={264} label="Sound" />
              {(tl.sfx ?? []).map((f, i) => (
                <button
                  key={`${f.at}-${i}`}
                  type="button"
                  onClick={() => {
                    setSel({ kind: 'sfx', index: i });
                    seekSource(f.at);
                    playSfx(f.kind, f.volume ?? 1);
                  }}
                  title={`${SFX_INFO[f.kind].label} at ${fmt(f.at)} · click to change or delete`}
                  className={cn('absolute top-[262px] h-7 overflow-hidden rounded-sm border border-amber-400/60 bg-amber-400/20 px-1 text-[9px] leading-7', sel?.kind === 'sfx' && sel.index === i && 'ring-2 ring-highlight')}
                  style={{ left: x(f.at), width: Math.max(18, 0.5 * pxPerSec) }}
                >
                  {SFX_INFO[f.kind].label}
                </button>
              ))}
              {/* Motion graphics */}
              <TrackLabel top={298} label="Graphics" />
              {(tl.graphics ?? []).map((g, i) => (
                <button
                  key={`${g.start}-${i}`}
                  type="button"
                  onClick={() => {
                    setSel({ kind: 'graphic', index: i });
                    seekSource(g.start + 0.6);
                  }}
                  title={`${graphicName(g)} · ${fmt(g.start)}–${fmt(g.end)} · click to change or delete`}
                  className={cn('absolute top-[296px] h-7 overflow-hidden whitespace-nowrap rounded-sm border border-rose-400/60 bg-rose-400/20 px-1 text-left text-[10px] leading-7', sel?.kind === 'graphic' && sel.index === i && 'ring-2 ring-highlight')}
                  style={{ left: x(g.start), width: Math.max(16, x(g.end) - x(g.start)) }}
                >
                  {graphicName(g)}
                </button>
              ))}
              {/* Playhead */}
              <div className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-highlight" style={{ left: x(playhead) }} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Click a block to select it · click a caption to edit it · <kbd>S</kbd> split at the playhead · <kbd>Delete</kbd> cut (or restore a striped cut) · click words to cut exactly what was said (Shift+click to select several) · <kbd>Space</kbd> play · <kbd>Ctrl+Z</kbd> undo
          </p>
        </CardContent>
      </Card>

      <TranscriptPanel
        words={words}
        removed={removed}
        removeFillers={tl.removeFillers}
        playhead={playhead}
        selection={sel?.kind === 'words' || sel?.kind === 'removed' ? sel : null}
        onSelect={(r, extend, isCut) => {
          if (extend && sel && (sel.kind === 'words' || sel.kind === 'removed')) setSel({ kind: sel.kind, start: Math.min(sel.start, r.start), end: Math.max(sel.end, r.end) });
          else setSel({ kind: isCut ? 'removed' : 'words', start: r.start, end: r.end });
          seekSource(r.start);
        }}
        onCut={() => deleteSel()}
      />
    </div>
  );
}

/**
 * Edit by text: the transcript as a paragraph. Click a word (Shift+click to extend) and cut it — or
 * click a struck-through word and restore it. The spoken word is underlined as the video plays.
 */
function TranscriptPanel({
  words,
  removed,
  removeFillers,
  playhead,
  selection,
  onSelect,
  onCut,
}: {
  words: Word[];
  removed: Range[];
  removeFillers: boolean;
  playhead: number;
  selection: { kind: string; start: number; end: number } | null;
  onSelect: (r: Range, extend: boolean, isCut: boolean) => void;
  onCut: () => void;
}) {
  if (!words.length) return null;
  const isCut = (w: Word) => (w.filler && removeFillers) || removed.some((r) => w.start >= r.start - 0.01 && w.end <= r.end + 0.01);
  const restoring = selection?.kind === 'removed';
  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">Transcript</CardTitle>
          <CardDescription>Edit the video by editing the text: select words and cut them; struck-through words are cut (click to restore).</CardDescription>
        </div>
        <Button size="sm" variant="outline" disabled={!selection} onClick={onCut}>
          {restoring ? <RotateCcw /> : <Scissors />} {restoring ? 'Restore selected' : 'Cut selected words'}
        </Button>
      </CardHeader>
      <CardContent>
        <p className="max-h-64 overflow-y-auto text-[15px] leading-8">
          {words.map((w, i) => {
            const cut = isCut(w);
            const inSel = selection && w.start >= selection.start - 0.001 && w.end <= selection.end + 0.001;
            const speaking = playhead >= w.start && playhead < w.end;
            return (
              <button
                key={i}
                type="button"
                onClick={(e) => onSelect({ start: w.start, end: w.end }, e.shiftKey, cut)}
                className={cn(
                  'mr-1 rounded px-0.5',
                  cut ? 'text-muted-foreground line-through decoration-2 opacity-60' : 'hover:bg-muted',
                  w.filler && 'italic',
                  inSel && 'bg-highlight/30',
                  speaking && 'underline decoration-highlight decoration-2 underline-offset-4',
                )}
              >
                {w.text}
              </button>
            );
          })}
        </p>
      </CardContent>
    </Card>
  );
}

/** Inputs for the live preview player: the real footage with this edit, captions, logo and watermark. */
function useFootageInput(
  project: Project,
  settings: ProjectSettings,
  segments: Range[],
  zooms: EditDoc['zooms'],
  texts: EditDoc['texts'],
  captionLines?: EditDoc['captions'],
  broll?: EditDoc['broll'],
  pool?: EditDoc['brollPool'],
  music?: EditDoc['music'],
  sfx?: EditDoc['sfx'],
  graphics?: EditDoc['graphics'],
) {
  const tracks = useMusicLibrary();
  const { data: wordsData } = useQuery({ queryKey: ['words', project.id, project.sourceAssetId], queryFn: () => api<{ data: { words: Word[] } }>(`/projects/${project.id}/words`).then((r) => r.data.words), staleTime: Infinity });
  const words = wordsData ?? [];
  const src = useAssetUrl(project.sourceAssetId);
  const { data: kit } = useBrandKit();
  const logoUrl = useAssetUrl(settings.useBrandKit !== false ? kit?.logo?.id : null);
  const { workspace } = useAuth();
  const [W, H] = SIZE[project.aspectRatio] ?? SIZE['9:16']!;
  const framing = resolveFraming(settings.framing ?? 'auto', project.sourceAsset?.width && project.sourceAsset?.height ? { width: project.sourceAsset.width, height: project.sourceAsset.height } : null, project.aspectRatio);
  const inputProps: FootageEditProps = useMemo(() => {
    // Timeline captions (what the export uses) when there are any; otherwise a quick layout of the words.
    const lines = captionLines?.length ? captionsToOutput(captionLines, segments) : previewLines(remapWords(words, segments), settings.captionStyle);
    return {
      src: src.data ?? '',
      segments,
      framing,
      zooms: zooms.flatMap((z) => {
        const r = rangeToOutput(segments, z.at, z.at + z.dur);
        return r ? [{ ...r, scale: z.scale }] : [];
      }),
      texts: texts.flatMap((t) => {
        const r = rangeToOutput(segments, t.start, t.end);
        return r ? [{ ...r, text: t.text, position: t.position, style: t.style, size: t.size, color: t.color }] : [];
      }),
      captions: settings.captionsEnabled && lines.length
        ? { lines, style: settings.captionStyle, position: settings.captionPosition, size: settings.captionSize, highlightColor: settings.highlightColor }
        : null,
      logo: logoUrl.data && kit ? { url: logoUrl.data, position: kit.logoPosition, widthFrac: LOGO_W[kit.logoSize], opacity: kit.logoOpacity } : null,
      watermark: workspace?.plan === 'free',
      broll: (broll ?? []).flatMap((b) => {
        const r = rangeToOutput(segments, b.start, b.end);
        return r ? [{ ...r, image: pool?.[b.clipId]?.thumbnailUrl ?? null }] : [];
      }),
      graphics: graphicsToOutput(graphics ?? [], segments, totalLength(segments)).map((g) => ({ ...g, color: g.color ?? settings.highlightColor ?? '#A78BFA' })),
      sfx: sfxToOutput(sfx ?? [], segments).map((x) => ({ at: x.at, src: sfxUrl(x.kind), volume: SFX_INFO[x.kind].level * x.volume * 1.4 })),
      music: (() => {
        const t = musicTrackFor(music ?? null, tracks, settings.musicMood, project.style, project.id);
        return t ? { src: t.previewUrl, volume: music?.volume ?? 0.25, duck: music?.duck ?? true, speech: mergeRanges(lines.flatMap((l) => l.words.map((w) => ({ start: w.start, end: w.end })))) } : null;
      })(),
    };
  }, [words, segments, src.data, framing, zooms, texts, captionLines, broll, pool, music, sfx, graphics, tracks, project.style, project.id, settings.musicMood, settings.captionsEnabled, settings.captionStyle, settings.captionPosition, settings.captionSize, settings.highlightColor, logoUrl.data, kit, workspace?.plan]);

  return { inputProps, words, src, W, H };
}

/** The live preview alone (used on the Style step), from the saved edit. */
export function FootagePreview({ project, settings }: { project: Project; settings: ProjectSettings }) {
  const e = project.edit;
  const segments = useMemo(() => (e ? (e.segments.length ? e.segments : keepSegments(e)) : []), [e]);
  const { inputProps, src, W, H } = useFootageInput(project, settings, segments, e?.zooms ?? [], e?.texts ?? [], e?.captions, e?.broll, e?.brollPool, e?.music, e?.sfx, e?.graphics);
  if (!e || !segments.length) return null;
  return (
    <div className="grid gap-1.5">
      <div className="mx-auto w-full overflow-hidden rounded-lg bg-black" style={{ maxWidth: W > H ? 560 : 280 }}>
        {src.data ? (
          <Player component={FootageEdit} inputProps={inputProps} durationInFrames={Math.max(1, Math.round(totalLength(segments) * FPS))} fps={FPS} compositionWidth={W} compositionHeight={H} style={{ width: '100%', aspectRatio: `${W} / ${H}` }} controls loop acknowledgeRemotionLicense />
        ) : (
          <div style={{ aspectRatio: `${W} / ${H}` }} />
        )}
      </div>
      <p className="text-center text-[11px] text-muted-foreground">Live preview of your edit — captions, framing and logo update as you change them</p>
    </div>
  );
}

function TrackLabel({ top, label }: { top: number; label: string }) {
  return (
    <span className="pointer-events-none absolute left-1 z-10 rounded bg-card/80 px-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ top: top - 10 }}>
      {label}
    </span>
  );
}

export interface MusicTrack {
  file: string;
  title: string;
  artist: string;
  moods: string[];
  durationSec: number | null;
  previewUrl: string;
}

/** The licensed background-music library (with short-lived preview links). */
function useMusicLibrary(): MusicTrack[] {
  const { data } = useQuery({ queryKey: ['music-library'], queryFn: () => api<{ data: { tracks: MusicTrack[] } }>('/music').then((r) => r.data.tracks), staleTime: 30 * 60_000 });
  return data ?? [];
}

const STYLE_MOOD: Record<string, string> = { viral: 'upbeat', podcast: 'lofi', cinematic: 'cinematic', educational: 'calm', business: 'corporate', storytelling: 'cinematic', vlog: 'upbeat', product_promotion: 'upbeat' };

/** The track the export will use — same rule as the server (services/ai/music.ts → pickTrack). */
function musicTrackFor(music: EditDoc['music'] | null, tracks: MusicTrack[], mood: string, style: string, seed: string): MusicTrack | null {
  if (!tracks.length) return null;
  const mode = music?.mode ?? (mood === 'none' ? 'none' : 'auto');
  if (mode === 'none') return null;
  if (mode === 'track') return tracks.find((t) => t.file === music?.file) ?? null;
  const m = !mood || mood === 'auto' || mood === 'none' ? (STYLE_MOOD[style] ?? 'upbeat') : mood;
  const list = tracks.filter((t) => t.moods.includes(m));
  const pick = list.length ? list : tracks;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pick[h % pick.length]!;
}
