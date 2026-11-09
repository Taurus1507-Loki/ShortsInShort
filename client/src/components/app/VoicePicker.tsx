import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Pause, Play, Search } from 'lucide-react';
import { Input, Select } from '../ui/input';
import { Notice, Skeleton } from '../ui/primitives';
import { useMeta, useVoices } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { VoiceInfo } from '@/types/api';

/** One shared <audio> so only one sample plays at a time. */
function usePreviewPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (v: VoiceInfo) => {
    if (!v.previewUrl) return;
    if (playing === v.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const a = new Audio(v.previewUrl);
    a.onended = () => setPlaying(null);
    a.onerror = () => setPlaying(null);
    audio.current = a;
    void a.play().then(() => setPlaying(v.id)).catch(() => setPlaying(null));
  };
  return { playing, toggle };
}

const titleCase = (s: string | null) => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : null);

/**
 * Browse and (optionally) choose a voice. Samples are streamed from the provider's public preview
 * clips — no credits are used for listening.
 */
export function VoicePicker({ value, onChange, compact }: { value?: string; onChange?: (v: VoiceInfo) => void; compact?: boolean }) {
  const { data: meta } = useMeta();
  const live = Boolean(meta?.features.voices);
  const { data: voices, isLoading, isError, error } = useVoices(live);
  const { playing, toggle } = usePreviewPlayer();
  const [q, setQ] = useState('');
  const [gender, setGender] = useState('');
  const [accent, setAccent] = useState('');

  const accents = useMemo(() => [...new Set((voices ?? []).map((v) => v.accent).filter(Boolean) as string[])].sort(), [voices]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (voices ?? []).filter(
      (v) =>
        (!gender || v.gender === gender) &&
        (!accent || v.accent === accent) &&
        (!needle || [v.name, v.description, v.useCase, v.accent].some((x) => x?.toLowerCase().includes(needle))),
    );
  }, [voices, q, gender, accent]);

  if (meta && !live) {
    return (
      <Notice tone="warning" title="AI voices aren’t switched on yet">
        Add an ElevenLabs API key (<code>ELEVENLABS_API_KEY</code>) to <code>server/.env</code> and restart the API. Until then no voices can be listed or generated.
      </Notice>
    );
  }
  if (isError) return <Notice tone="error" title="Couldn’t load voices">{errorMessage(error)}</Notice>;
  if (isLoading || !voices) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  const selected = voices.find((v) => v.id === value);
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_140px_160px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search voices" placeholder="Search by name, style or use…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select aria-label="Filter by gender" value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">Any gender</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="neutral">Neutral</option>
        </Select>
        <Select aria-label="Filter by accent" value={accent} onChange={(e) => setAccent(e.target.value)}>
          <option value="">Any accent</option>
          {accents.map((a) => (
            <option key={a} value={a}>
              {titleCase(a)}
            </option>
          ))}
        </Select>
      </div>
      {value && !selected && <Notice tone="warning">The voice saved on this project is no longer available. Choose another one.</Notice>}
      <p className="text-xs text-muted-foreground">
        {filtered.length} of {voices.length} voices · ▶ plays a free sample. Every voice can speak all supported languages; accent describes how it sounds in English.
      </p>
      <ul className={cn('grid gap-2 overflow-y-auto pr-1 sm:grid-cols-2', compact ? 'max-h-[340px]' : 'max-h-[620px]')} role={onChange ? 'radiogroup' : undefined} aria-label="Voices">
        {filtered.map((v) => {
          const isSel = v.id === value;
          const tags = [titleCase(v.gender), titleCase(v.age), titleCase(v.accent)].filter(Boolean).join(' · ');
          return (
            <li key={v.id}>
              <div
                className={cn(
                  'flex h-full items-start gap-3 rounded-lg border p-3 transition-colors',
                  isSel ? 'border-primary bg-primary/10' : 'border-border',
                  onChange && !isSel && 'hover:border-primary/40',
                )}
              >
                <button
                  type="button"
                  onClick={() => toggle(v)}
                  disabled={!v.previewUrl}
                  aria-label={playing === v.id ? `Stop ${v.name} sample` : `Play ${v.name} sample`}
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-primary hover:text-white disabled:opacity-40"
                >
                  {playing === v.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  role={onChange ? 'radio' : undefined}
                  aria-checked={onChange ? isSel : undefined}
                  disabled={!onChange}
                  onClick={() => onChange?.(v)}
                  className="min-w-0 flex-1 text-left disabled:cursor-default"
                >
                  <span className="flex items-center gap-1.5 font-semibold">
                    {v.name}
                    {isSel && <Check className="h-4 w-4 text-primary" />}
                    {v.category !== 'premade' && <span className="rounded bg-muted px-1.5 text-[10px] font-medium uppercase text-muted-foreground">{v.category}</span>}
                  </span>
                  {tags && <span className="block text-xs text-muted-foreground">{tags}</span>}
                  {(v.description || v.useCase) && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{[titleCase(v.description), titleCase(v.useCase)].filter(Boolean).join(' · ')}</span>
                  )}
                </button>
              </div>
            </li>
          );
        })}
        {filtered.length === 0 && <li className="col-span-full py-6 text-center text-sm text-muted-foreground">No voices match these filters.</li>}
      </ul>
    </div>
  );
}
