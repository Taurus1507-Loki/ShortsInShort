import { useRef, useState } from 'react';
import { CheckCircle2, Film, Loader2, UploadCloud, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Notice } from '../ui/primitives';
import { useMeta } from '@/lib/queries';
import { ACCEPT_ATTR, ACCEPTED_EXTENSIONS, formatDuration, readVideoDuration, uploadVideo, type UploadPhase } from '@/lib/upload';
import { errorMessage } from '@/lib/api';
import { cn, formatBytes } from '@/lib/utils';
import type { Asset } from '@/types/api';

const PHASE_LABEL: Record<UploadPhase, string> = { preparing: 'Preparing…', uploading: 'Uploading', verifying: 'Checking your video…' };

/** Drag-and-drop video uploader with validation, progress and cancel. */
export function VideoUploader({ onUploaded, current, compact }: { onUploaded: (a: Asset) => void; current?: Asset | null; compact?: boolean }) {
  const { data: meta } = useMeta();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const maxBytes = meta?.uploads.maxBytes ?? 500 * 1024 * 1024;
  const maxDuration = meta?.uploads.maxSourceDurationSec ?? 900;

  async function handle(f: File) {
    setError(null);
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ACCEPTED_EXTENSIONS.includes(ext)) return setError('Choose an MP4, MOV, WEBM or MKV video.');
    if (f.size > maxBytes) return setError(`That file is ${formatBytes(f.size)}. The limit is ${formatBytes(maxBytes)}.`);
    const d = await readVideoDuration(f);
    if (d && d > maxDuration) return setError(`That video is ${formatDuration(d)} long. The limit is ${Math.round(maxDuration / 60)} minutes.`);

    setFile(f);
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const asset = await uploadVideo(f, { onPhase: setPhase, onProgress: setProgress, signal: controller.signal });
      onUploaded(asset);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
    } finally {
      setPhase(null);
      setFile(null);
      abortRef.current = null;
    }
  }

  const busy = phase !== null;

  return (
    <div className="grid gap-3">
      {current && !busy && (
        <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{current.originalName}</p>
            <p className="text-xs text-muted-foreground">
              {formatDuration(current.durationSec)} · {current.width}×{current.height} · {formatBytes(current.sizeBytes)}
              {current.hasAudio === false && ' · no audio track'}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>
            Replace
          </Button>
        </div>
      )}

      {busy && file ? (
        <div className="rounded-xl border border-border bg-muted/30 p-4" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <Film className="h-5 w-5 shrink-0 text-highlight" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {PHASE_LABEL[phase!]}
                {phase === 'uploading' && ` · ${Math.round(progress * 100)}% of ${formatBytes(file.size)}`}
              </p>
            </div>
            {phase === 'uploading' ? (
              <Button size="icon" variant="ghost" onClick={() => abortRef.current?.abort()} aria-label="Cancel upload">
                <X />
              </Button>
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-300" style={{ width: `${phase === 'verifying' ? 100 : Math.round(progress * 100)}%` }} />
          </div>
        </div>
      ) : (
        !current && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) void handle(f);
            }}
            className={cn(
              'grid place-items-center rounded-xl border-2 border-dashed px-6 text-center transition-colors',
              compact ? 'py-6' : 'py-10',
              drag ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 hover:bg-muted/30',
            )}
          >
            <UploadCloud className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">Drop your video here, or click to browse</p>
            <p className="mt-1 text-xs text-muted-foreground">
              MP4, MOV, WEBM or MKV · up to {formatBytes(maxBytes)} · up to {Math.round(maxDuration / 60)} min
            </p>
          </button>
        )
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a video file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handle(f);
        }}
      />
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
