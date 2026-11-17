import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Coins, Loader2, Minus, Pause, Play, Plus, Redo2, RotateCcw, Scissors, Sparkles, Trash2, Type, Undo2, ZoomIn } from 'lucide-react';
import { Button } from '../ui/button';
import { Input, Select } from '../ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Notice } from '../ui/primitives';
import { StopButton } from './ProjectActions';
import { resolveFraming } from './LivePreview';
import { FootageEdit, type FootageEditProps } from '@/motion/FootageEdit';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useAssetUrl, useBrandKit, useJob } from '@/lib/queries';
import { useAuth } from '@/features/auth/AuthProvider';
import { keepSegments, mergeRanges, previewLines, rangeToOutput, remapWords, removedRanges, subtractRanges, toOutput, toSource, totalLength, type EditDoc, type Range, type Word } from '@/features/edl';
import { cn } from '@/lib/utils';
import type { Project, ProjectSettings } from '@/types/api';

const FPS = 30;
const SIZE: Record<string, [number, number]> = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [720, 720], '4:5': [720, 900] };
const LOGO_W = { small: 0.12, medium: 0.18, large: 0.25 } as const;
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

type Selection = { kind: 'kept' | 'removed' | 'words'; start: number; end: number } | { kind: 'zoom'; index: number } | { kind: 'text'; index: number } | null;
type Timeline = Pick<EditDoc, 'pauseSec' | 'removeFillers' | 'cuts' | 'restores' | 'zooms' | 'texts'>;

/**
 * AI Video Editor "Edit" step: analyse once, then edit by hand on a timeline while a player shows the
 * real result (cuts, zooms, captions, text, logo). Every change saves automatically; the export
 * renders exactly what the player shows.
 */
export function TimelineEditor({ project, settings }: { project: Project; settings: ProjectSettings }) {
  const edit = project.edit;
  const analyzed = Boolean(edit && edit.sourceAssetId === project.sourceAssetId);
  if (!analyzed) return <AnalyzeCard project={project} />;
  return <Editor key={edit!.analyzedAt} project={project} edit={edit!} settings={settings} />;
}

function AnalyzeCard({ project }: { project: Project }) {
  const busy = project.status === 'queued' || project.status === 'processing';
  const job = useJob(project.id, busy);
  const estimate = useQuery({
    queryKey: ['analyze-estimate', project.id, project.sourceAssetId],
    queryFn: () => api<{ data: { credits: number; balance: number; sourceDurationSec: number } }>(`/projects/${project.id}/analyze/estimate`).then((r) => r.data),
    enabled: Boolean(project.sourceAssetId) && !busy,
  });
  const analyze = useMutation({
    mutationFn: () => api(`/projects/${project.id}/analyze`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.project(project.id) });
      queryClient.invalidateQueries({ queryKey: keys.job(project.id) });
      queryClient.invalidateQueries({ queryKey: keys.me });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const e = estimate.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analyse your video</CardTitle>
        <CardDescription>
          AI transcribes the speech and finds every pause and filler word (“um”, “uh”). Then you edit on a timeline: cut, restore, add zooms and text, and watch the result as you go. Nothing is removed until you decide.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {busy ? (
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="flex-1">{job.data?.stage === 'transcribing' ? 'Transcribing speech…' : job.data?.stage === 'finding_pauses' ? 'Finding pauses and filler words…' : 'Analysing…'} {job.data?.progress ?? 0}%</span>
            <StopButton project={project} />
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Coins className="h-4 w-4 text-highlight" />
              {e ? (e.credits ? `${e.credits} credits (3 per minute of footage, once) · you have ${e.balance}` : 'Free — this video was analysed before') : 'Checking the price…'}
            </p>
            <Button variant="gradient" onClick={() => analyze.mutate()} loading={analyze.isPending} disabled={!e || e.balance < e.credits}>
              <Sparkles /> Analyse video
            </Button>
          </div>
        )}
        {project.lastError && !busy && <Notice tone="warning">{project.lastError}</Notice>}
      </CardContent>
    </Card>
  );
}

function Editor({ project, edit, settings }: { project: Project; edit: EditDoc; settings: ProjectSettings }) {
  const duration = edit.durationSec;
  const [tl, setTl] = useState<Timeline>({ pauseSec: edit.pauseSec, removeFillers: edit.removeFillers, cuts: edit.cuts, restores: edit.restores, zooms: edit.zooms, texts: edit.texts });
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
  const { inputProps, words, src, W, H } = useFootageInput(project, settings, segments, tl.zooms, tl.texts);

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
    setSel(null);
  };
  const addZoom = () => {
    change((t) => ({ ...t, zooms: [...t.zooms, { at: Math.round(playhead * 100) / 100, dur: 1.5, scale: 1.12 }].sort((a, b) => a.at - b.at) }));
  };
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
              style={{ width, height: 182 }}
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
              <TrackLabel top={72} label="Words" />
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
                    className={cn('absolute top-[70px] h-7 overflow-hidden whitespace-nowrap rounded-sm px-0.5 text-left text-[10px] leading-7', gone ? 'text-muted-foreground line-through opacity-50' : 'bg-card text-foreground', w.filler && 'italic text-warning', inSel && 'bg-highlight/30 ring-1 ring-highlight')}
                    style={{ left: x(w.start), width: Math.max(4, x(w.end) - x(w.start) - 1) }}
                  >
                    {w.text}
                  </button>
                );
              })}
              {/* Zooms */}
              <TrackLabel top={104} label="Zoom" />
              {tl.zooms.map((z, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setSel({ kind: 'zoom', index: i });
                    seekSource(z.at);
                  }}
                  title={`Zoom ${Math.round((z.scale - 1) * 100)}% for ${z.dur}s`}
                  className={cn('absolute top-[104px] h-6 rounded-sm border border-accent/60 bg-accent/30', sel?.kind === 'zoom' && sel.index === i && 'ring-2 ring-highlight')}
                  style={{ left: x(z.at), width: Math.max(8, z.dur * pxPerSec) }}
                />
              ))}
              {/* Text */}
              <TrackLabel top={134} label="Text" />
              {tl.texts.map((t, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setSel({ kind: 'text', index: i });
                    seekSource(t.start);
                  }}
                  className={cn('absolute top-[134px] h-7 overflow-hidden whitespace-nowrap rounded-sm border border-success/60 bg-success/20 px-1 text-left text-[10px] leading-7', sel?.kind === 'text' && sel.index === i && 'ring-2 ring-highlight')}
                  style={{ left: x(t.start), width: Math.max(12, x(t.end) - x(t.start)) }}
                >
                  {t.text}
                </button>
              ))}
              {/* Playhead */}
              <div className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-highlight" style={{ left: x(playhead) }} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Click a block to select it · <kbd>S</kbd> split at the playhead · <kbd>Delete</kbd> cut (or restore a striped cut) · click words to cut exactly what was said (Shift+click to select several) · <kbd>Space</kbd> play · <kbd>Ctrl+Z</kbd> undo
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** Inputs for the live preview player: the real footage with this edit, captions, logo and watermark. */
function useFootageInput(project: Project, settings: ProjectSettings, segments: Range[], zooms: EditDoc['zooms'], texts: EditDoc['texts']) {
  const { data: wordsData } = useQuery({ queryKey: ['words', project.id, project.sourceAssetId], queryFn: () => api<{ data: { words: Word[] } }>(`/projects/${project.id}/words`).then((r) => r.data.words), staleTime: Infinity });
  const words = wordsData ?? [];
  const src = useAssetUrl(project.sourceAssetId);
  const { data: kit } = useBrandKit();
  const logoUrl = useAssetUrl(settings.useBrandKit !== false ? kit?.logo?.id : null);
  const { workspace } = useAuth();
  const [W, H] = SIZE[project.aspectRatio] ?? SIZE['9:16']!;
  const framing = resolveFraming(settings.framing ?? 'auto', project.sourceAsset?.width && project.sourceAsset?.height ? { width: project.sourceAsset.width, height: project.sourceAsset.height } : null, project.aspectRatio);
  const inputProps: FootageEditProps = useMemo(() => {
    const out = remapWords(words, segments);
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
        return r ? [{ ...r, text: t.text, position: t.position }] : [];
      }),
      captions: settings.captionsEnabled && out.length
        ? { lines: previewLines(out, settings.captionStyle), style: settings.captionStyle, position: settings.captionPosition, size: settings.captionSize, highlightColor: settings.highlightColor }
        : null,
      logo: logoUrl.data && kit ? { url: logoUrl.data, position: kit.logoPosition, widthFrac: LOGO_W[kit.logoSize], opacity: kit.logoOpacity } : null,
      watermark: workspace?.plan === 'free',
    };
  }, [words, segments, src.data, framing, zooms, texts, settings.captionsEnabled, settings.captionStyle, settings.captionPosition, settings.captionSize, settings.highlightColor, logoUrl.data, kit, workspace?.plan]);

  return { inputProps, words, src, W, H };
}

/** The live preview alone (used on the Style step), from the saved edit. */
export function FootagePreview({ project, settings }: { project: Project; settings: ProjectSettings }) {
  const e = project.edit;
  const segments = useMemo(() => (e ? (e.segments.length ? e.segments : keepSegments(e)) : []), [e]);
  const { inputProps, src, W, H } = useFootageInput(project, settings, segments, e?.zooms ?? [], e?.texts ?? []);
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
