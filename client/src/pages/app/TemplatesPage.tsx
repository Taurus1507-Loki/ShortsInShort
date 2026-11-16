import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Player, Thumbnail } from '@remotion/player';
import { toast } from 'sonner';
import { Clapperboard, Eye, Search, Star, UserRound, Wand2, type LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { useMotionLook } from '@/components/app/MotionScenes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/overlays';
import { CAPTION_STYLES, modeName, styleName } from '@/config/options';
import { api, errorMessage } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { MotionVideo } from '@/motion/MotionVideo';
import { MOTION_FPS } from '@/motion/types';
import type { AspectRatio, ProjectMode } from '@/types/api';
import { useTemplates, type VideoTemplate } from '@/features/templates';

const CATEGORIES: Array<[VideoTemplate['category'] | 'all' | 'favorites', string]> = [
  ['all', 'All'],
  ['favorites', 'Favourites'],
  ['marketing', 'Marketing'],
  ['social', 'Social'],
  ['education', 'Education'],
  ['business', 'Business'],
  ['lifestyle', 'Lifestyle'],
];
const MODE_ICON: Record<ProjectMode, LucideIcon> = { editor: Wand2, avatar: UserRound, faceless: Clapperboard };
const SIZE: Record<AspectRatio, [number, number]> = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };

/** What a template sets up, in plain words, for the card and the preview dialog. */
function summary(t: VideoTemplate): string[] {
  const s = t.settings;
  const out = [modeName(t.mode), styleName(t.style), t.aspectRatio];
  if (t.mode === 'faceless') out.push(s.facelessStyle === 'motion' ? 'Animated scenes' : 'Stock footage');
  if (s.bRollIntensity && s.bRollIntensity !== 'none') out.push(`B-roll ${s.bRollIntensity}`);
  if (s.captionStyle) out.push(`${CAPTION_STYLES.find((c) => c.id === s.captionStyle)?.name ?? s.captionStyle} captions`);
  if (s.sceneTransition && s.sceneTransition !== 'cut') out.push(`${s.sceneTransition} transitions`);
  return out;
}

/** Templates gallery: search, filter by category or favourites, preview, and start a project from one. */
export default function TemplatesPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useTemplates();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<(typeof CATEGORIES)[number][0]>('all');
  const [open, setOpen] = useState<VideoTemplate | null>(null);

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (data ?? []).filter((t) => {
      if (cat === 'favorites' ? !t.favorite : cat !== 'all' && t.category !== cat) return false;
      const hay = `${t.name} ${t.description} ${t.bestFor} ${t.category} ${modeName(t.mode)}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [data, q, cat]);

  const use = (t: VideoTemplate) => navigate(`/app/new?mode=${t.mode}&template=${t.id}`);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Templates" description="Start from a proven format. A template sets the mode, style, frame, captions and a script outline — you change anything after." />
      <div className="mb-6 grid gap-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates (e.g. recipe, pitch, podcast)" aria-label="Search templates" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Categories">
          {CATEGORIES.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={cat === id}
              onClick={() => setCat(id)}
              className={cn('rounded-full border px-3 py-1 text-sm transition-colors', cat === id ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
            >
              {id === 'favorites' && <Star className="mr-1 inline h-3.5 w-3.5" />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {isError ? (
        <p className="text-sm text-destructive">{errorMessage(error)}</p>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{cat === 'favorites' ? 'No favourites yet — tap the star on a template to save it here.' : 'No templates match your search.'}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((t) => (
            <li key={t.id}>
              <TemplateCard t={t} onPreview={() => setOpen(t)} onUse={() => use(t)} />
            </li>
          ))}
        </ul>
      )}
      {open && <PreviewDialog t={open} onClose={() => setOpen(null)} onUse={() => use(open)} />}
    </div>
  );
}

function FavoriteButton({ t }: { t: VideoTemplate }) {
  const toggle = useMutation({
    mutationFn: () => api(`/templates/${t.id}/favorite`, { method: t.favorite ? 'DELETE' : 'PUT' }),
    onMutate: () => queryClient.setQueryData<VideoTemplate[]>(['templates'], (old) => old?.map((x) => (x.id === t.id ? { ...x, favorite: !x.favorite } : x))),
    onError: (e) => {
      toast.error(errorMessage(e));
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
  return (
    <button
      type="button"
      onClick={() => toggle.mutate()}
      aria-pressed={t.favorite}
      aria-label={t.favorite ? `Remove ${t.name} from favourites` : `Add ${t.name} to favourites`}
      className="grid h-8 w-8 place-items-center rounded-full bg-black/50 text-white backdrop-blur hover:bg-black/70"
    >
      <Star className={cn('h-4 w-4', t.favorite && 'fill-yellow-400 text-yellow-400')} />
    </button>
  );
}

function TemplateCard({ t, onPreview, onUse }: { t: VideoTemplate; onPreview: () => void; onUse: () => void }) {
  const Icon = MODE_ICON[t.mode];
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="relative">
        <button type="button" onClick={onPreview} className="block w-full" aria-label={`Preview ${t.name}`}>
          <PreviewStrip t={t} />
        </button>
        <div className="absolute right-2 top-2">
          <FavoriteButton t={t} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-semibold">{t.name}</h3>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="muted" className="gap-1">
            <Icon className="h-3 w-3" /> {modeName(t.mode)}
          </Badge>
          <Badge variant="muted">{t.aspectRatio}</Badge>
          {t.mode === 'faceless' && <Badge variant="muted">{t.settings.facelessStyle === 'motion' ? 'Animated' : 'Stock footage'}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{t.description}</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Best for:</span> {t.bestFor}
        </p>
        <div className="mt-auto flex gap-2 pt-2">
          <Button size="sm" className="flex-1" onClick={onUse}>
            Use template
          </Button>
          <Button size="sm" variant="outline" onClick={onPreview}>
            <Eye /> Preview
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Card visual: a still of the first animated scene, or a storyboard of real stock thumbnails. */
function PreviewStrip({ t }: { t: VideoTemplate }) {
  const look = useMotionLook(t.settings.motionTheme, t.id);
  if (t.preview === 'motion' && t.motionScenes?.length) {
    const [w, h] = SIZE[t.aspectRatio];
    return (
      <div className="flex h-48 items-center justify-center gap-1.5 bg-black/40 p-2">
        {t.motionScenes.slice(0, w > h ? 1 : 3).map((sc, i) => (
          <div key={i} className="h-full overflow-hidden rounded-md" style={{ aspectRatio: `${w} / ${h}` }}>
            <Thumbnail component={MotionVideo} inputProps={{ scenes: [{ ...sc, durationInFrames: 90 }], ...look, transitions: false, seed: (look.seed ?? 0) + i }} compositionWidth={w} compositionHeight={h} frameToDisplay={70} durationInFrames={90} fps={MOTION_FPS} style={{ height: '100%', width: '100%' }} />
          </div>
        ))}
      </div>
    );
  }
  return <StockStrip t={t} className="h-48" />;
}

function StockStrip({ t, className }: { t: VideoTemplate; className?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['templates', t.id, 'preview'],
    queryFn: () => api<{ data: { thumbnails: string[] } }>(`/templates/${t.id}/preview`).then((r) => r.data.thumbnails),
    staleTime: 60 * 60_000,
    enabled: t.preview === 'stock',
  });
  const Icon = MODE_ICON[t.mode];
  if (isLoading) return <Skeleton className={cn('rounded-none', className)} />;
  if (!data?.length)
    return (
      <div className={cn('grid place-items-center bg-gradient-to-br from-primary/30 to-accent/20', className)}>
        <Icon className="h-10 w-10 text-foreground/70" />
      </div>
    );
  return (
    <div className={cn('relative flex gap-0.5 overflow-hidden bg-black', className)}>
      {data.map((src) => (
        <img key={src} src={src} alt="" loading="lazy" className="h-full min-w-0 flex-1 object-cover" referrerPolicy="no-referrer" />
      ))}
      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/80">Sample stock footage</span>
    </div>
  );
}

function PreviewDialog({ t, onClose, onUse }: { t: VideoTemplate; onClose: () => void; onUse: () => void }) {
  const look = useMotionLook(t.settings.motionTheme, t.id);
  const [w, h] = SIZE[t.aspectRatio];
  const motion = t.preview === 'motion' && t.motionScenes?.length;
  const inputProps = useMemo(() => ({ scenes: (t.motionScenes ?? []).map((sc) => ({ ...sc, durationInFrames: 3 * MOTION_FPS })), ...look }), [t, look]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogTitle className="text-lg font-semibold">{t.name}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t.description}</DialogDescription>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div>
            {motion ? (
              <div className="mx-auto overflow-hidden rounded-lg border border-border bg-black" style={{ maxWidth: w > h ? '100%' : 260 }}>
                <Player component={MotionVideo} inputProps={inputProps} durationInFrames={inputProps.scenes.length * 3 * MOTION_FPS} fps={MOTION_FPS} compositionWidth={w} compositionHeight={h} style={{ width: '100%', aspectRatio: `${w} / ${h}` }} controls autoPlay loop acknowledgeRemotionLicense />
              </div>
            ) : (
              <StockStrip t={t} className="h-64 rounded-lg" />
            )}
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {motion ? 'Sample animation — your video uses your own words, colours and voiceover.' : t.mode === 'faceless' ? 'Sample clips — your video picks clips that match each line of your script.' : 'Sample visuals — your video is built from your own footage.'}
            </p>
          </div>
          <div className="grid content-start gap-4 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {summary(t).map((s) => (
                <Badge key={s} variant="muted">
                  {s}
                </Badge>
              ))}
            </div>
            <div>
              <p className="mb-1 font-semibold">{t.mode === 'editor' ? 'How to use it' : 'Script outline'}</p>
              <p className="whitespace-pre-line rounded-md bg-muted/40 p-3 text-muted-foreground">{t.script}</p>
              {t.mode !== 'editor' && <p className="mt-1 text-[11px] text-muted-foreground">Pre-filled in the next step — rewrite it or use “Write it with AI”.</p>}
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Best for:</span> {t.bestFor}
            </p>
            <div className="flex gap-2">
              <Button onClick={onUse}>Use template</Button>
              <FavoriteInline t={t} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog favourite toggle that follows the cached list (so it stays in sync with the card). */
function FavoriteInline({ t }: { t: VideoTemplate }) {
  const { data } = useTemplates();
  const live = data?.find((x) => x.id === t.id) ?? t;
  const toggle = useMutation({
    mutationFn: () => api(`/templates/${live.id}/favorite`, { method: live.favorite ? 'DELETE' : 'PUT' }),
    onMutate: () => queryClient.setQueryData<VideoTemplate[]>(['templates'], (old) => old?.map((x) => (x.id === live.id ? { ...x, favorite: !x.favorite } : x))),
    onError: (e) => {
      toast.error(errorMessage(e));
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
  return (
    <Button variant="outline" onClick={() => toggle.mutate()} aria-pressed={live.favorite}>
      <Star className={cn(live.favorite && 'fill-yellow-400 text-yellow-400')} /> {live.favorite ? 'Saved' : 'Save'}
    </Button>
  );
}
