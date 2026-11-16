import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, Music, Pause, Play, Trash2, Upload } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge, Card, Notice, Skeleton } from '../ui/primitives';
import { api, blobUrl, errorMessage, uploadRaw } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import { cn } from '@/lib/utils';

interface Track {
  file: string;
  title: string;
  artist: string;
  moods: string[];
  license: string;
  durationSec?: number;
  usable: boolean;
}
interface Library {
  tracks: Track[];
  moods: string[];
  license: { name: string; url: string };
}

const KEY = ['admin', 'music'];
const MOOD_LABEL: Record<string, string> = { upbeat: 'Upbeat', calm: 'Calm', cinematic: 'Cinematic', corporate: 'Corporate', lofi: 'Lo-fi' };
const mmss = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—');

/**
 * Admin: background music. Pixabay has no music API, so admins download tracks from Pixabay Music
 * and drop them here; the server checks, loudness-normalises and mood-tags each one.
 */
export function MusicLibrary() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: KEY, queryFn: () => api<{ data: Library }>('/admin/music').then((r) => r.data) });
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [drag, setDrag] = useState(false);

  const upload = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f.name));
    if (!list.length) return toast.error('Choose MP3, M4A, WAV or OGG files.');
    setProgress({ done: 0, total: list.length });
    let added = 0;
    for (const [i, f] of list.entries()) {
      try {
        const r = await uploadRaw<{ data: { duplicate: boolean } }>(`/admin/music?name=${encodeURIComponent(f.name)}`, f);
        if (!r.data.duplicate) added++;
      } catch (e) {
        toast.error(`${f.name}: ${errorMessage(e)}`);
      }
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
    queryClient.invalidateQueries({ queryKey: KEY });
    queryClient.invalidateQueries({ queryKey: ['meta'] });
    if (added) toast.success(`${added} track${added === 1 ? '' : 's'} added — check their moods below`);
  };

  return (
    <div className="grid gap-5">
      <Notice tone="info" title="Where the music comes from">
        Pixabay has no music API, so tracks are added by hand: download them from{' '}
        <a href="https://pixabay.com/music/" target="_blank" rel="noopener noreferrer" className="font-semibold underline">
          pixabay.com/music <ExternalLink className="inline h-3 w-3" />
        </a>{' '}
        (free under the{' '}
        <a href={data?.license.url ?? 'https://pixabay.com/service/license-summary/'} target="_blank" rel="noopener noreferrer" className="underline">
          Pixabay Content License
        </a>
        , fine for commercial videos, no credit needed) and drop them here. Each track is converted to the same loudness and tagged with moods from its name; fix the moods if needed. Aim for 3+ tracks per mood so videos don’t repeat.
      </Notice>

      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files);
        }}
        disabled={Boolean(progress)}
        className={cn('grid place-items-center gap-2 rounded-xl border-2 border-dashed p-8 text-sm transition-colors', drag ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50')}
      >
        <Upload className="h-6 w-6 text-highlight" />
        {progress ? (
          <span>
            Importing {progress.done} of {progress.total}… (converting each to the same loudness)
          </span>
        ) : (
          <span>
            <strong>Drop Pixabay music files here</strong> or click to choose (MP3, M4A, WAV, OGG · up to 40 MB each)
          </span>
        )}
      </button>
      <input ref={input} type="file" accept=".mp3,.m4a,.wav,.ogg,audio/*" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} />

      {isError && <Notice tone="error">{errorMessage(error)}</Notice>}
      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : data && data.tracks.length > 0 ? (
        <>
          <MoodCoverage tracks={data.tracks} moods={data.moods} />
          <Card className="divide-y divide-border">
            {data.tracks.map((t) => (
              <TrackRow key={t.file} track={t} moods={data.moods} />
            ))}
          </Card>
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          <Music className="mx-auto mb-2 h-6 w-6" />
          No music yet — videos are made without background music until you add some.
        </p>
      )}
    </div>
  );
}

function MoodCoverage({ tracks, moods }: { tracks: Track[]; moods: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {moods.map((m) => {
        const n = tracks.filter((t) => t.usable && t.moods.includes(m)).length;
        return (
          <span key={m} className={cn('rounded-full border px-2.5 py-1', n >= 3 ? 'border-success/40 text-success' : n ? 'border-warning/40 text-warning' : 'border-border text-muted-foreground')}>
            {MOOD_LABEL[m] ?? m}: {n} track{n === 1 ? '' : 's'}
          </span>
        );
      })}
    </div>
  );
}

function TrackRow({ track, moods }: { track: Track; moods: string[] }) {
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const save = useMutation({
    mutationFn: (next: string[]) => api(`/admin/music/${track.file}`, { method: 'PATCH', body: { moods: next } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/admin/music/${track.file}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(`Removed “${track.title}”`);
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: ['meta'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = async () => {
    try {
      if (!url) {
        const u = await blobUrl(`/admin/music/${track.file}/audio`);
        setUrl(u);
        setPlaying(true);
        setTimeout(() => void audio.current?.play(), 0);
        return;
      }
      if (playing) audio.current?.pause();
      else void audio.current?.play();
      setPlaying(!playing);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const flip = (m: string) => {
    const next = track.moods.includes(m) ? track.moods.filter((x) => x !== m) : [...track.moods, m];
    if (!next.length) return toast.error('A track needs at least one mood.');
    save.mutate(next);
  };
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <Button variant="outline" size="sm" onClick={() => void toggle()} aria-label={playing ? 'Pause' : `Play ${track.title}`}>
        {playing ? <Pause /> : <Play />}
      </Button>
      {url && <audio ref={audio} src={url} onEnded={() => setPlaying(false)} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {track.title} <span className="font-normal text-muted-foreground">· {track.artist}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {mmss(track.durationSec)} · {track.license}
          {!track.usable && <Badge className="ml-2" variant="destructive">File missing</Badge>}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {moods.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => flip(m)}
            disabled={save.isPending}
            className={cn('rounded-full border px-2.5 py-1 text-xs', track.moods.includes(m) ? 'border-primary bg-primary/15 font-semibold' : 'border-border text-muted-foreground hover:border-primary/40')}
          >
            {MOOD_LABEL[m] ?? m}
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={() => remove.mutate()} loading={remove.isPending} aria-label={`Remove ${track.title}`}>
        <Trash2 />
      </Button>
    </div>
  );
}
