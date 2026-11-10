import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImageIcon, Palette, Sparkles, Upload, Video, Wand2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input, Select } from '../ui/input';
import { Field, Notice } from '../ui/primitives';
import { VideoUploader } from './VideoUploader';
import { api, errorMessage } from '@/lib/api';
import { useAssetUrl, useBrandKit, useMeta } from '@/lib/queries';
import { uploadVideo } from '@/lib/upload';
import { cn } from '@/lib/utils';
import type { Asset, EditingStyle, ProjectSettings } from '@/types/api';

const KINDS: Array<{ id: ProjectSettings['background']; label: string; sub: string; icon: typeof Palette }> = [
  { id: 'brand', label: 'Brand gradient', sub: 'Your Brand Kit colours, gently moving', icon: Sparkles },
  { id: 'color', label: 'Solid colour', sub: 'One clean colour', icon: Palette },
  { id: 'image', label: 'Image', sub: 'Your photo, slowly panning', icon: ImageIcon },
  { id: 'video', label: 'Video', sub: 'Your clip, looped and muted', icon: Video },
];

/**
 * What sits behind the captions in a voiceover video. Image/video files are attached to the project
 * straight away (`onAsset`); the kind and colour are part of the project settings.
 */
export function BackgroundPicker({
  settings,
  onChange,
  asset,
  onAsset,
}: {
  settings: ProjectSettings;
  onChange: (patch: Partial<ProjectSettings>) => void;
  asset: Asset | null | undefined;
  onAsset: (a: Asset | null) => void;
}) {
  const { data: kit } = useBrandKit();
  const [uploading, setUploading] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const preview = useAssetUrl(asset?.kind === 'background_image' ? asset.id : asset?.thumbnailAssetId);
  const kind = settings.background ?? 'brand';
  const assetFits = kind === 'image' ? asset?.kind === 'background_image' : kind === 'video' ? asset?.kind === 'source_video' : true;

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      onAsset(await uploadVideo(file, { purpose: 'background' }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Background">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={kind === k.id}
            onClick={() => onChange({ background: k.id })}
            className={cn('rounded-lg border p-3 text-left transition-colors', kind === k.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40')}
          >
            <k.icon className="h-4 w-4 text-primary" />
            <span className="mt-1.5 block text-sm font-semibold">{k.label}</span>
            <span className="block text-xs text-muted-foreground">{k.sub}</span>
          </button>
        ))}
      </div>

      {kind === 'brand' && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="h-10 w-16 rounded-md border border-border" style={{ background: `linear-gradient(135deg, ${kit?.primaryColor ?? '#7C3AED'}, ${kit?.secondaryColor ?? '#0F172A'})` }} />
          Uses your Brand Kit primary and secondary colours. Change them on the Brand Kit page.
        </div>
      )}

      {kind === 'color' && (
        <Field id="bg-color" label="Colour" hint="Darker colours keep white captions easy to read.">
          <div className="flex items-center gap-2">
            <input type="color" aria-label="Background colour" value={settings.backgroundColor} onChange={(e) => onChange({ backgroundColor: e.target.value.toUpperCase() })} className="h-10 w-14 cursor-pointer rounded border border-border bg-transparent" />
            <Input value={settings.backgroundColor} readOnly className="max-w-[120px]" aria-label="Background colour hex" />
          </div>
        </Field>
      )}

      {kind === 'image' && (
        <div className="flex flex-wrap items-center gap-3">
          {assetFits && preview.data ? <img src={preview.data} alt="" className="h-20 w-20 rounded-md object-cover" /> : <div className="grid h-20 w-20 place-items-center rounded-md bg-muted"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>}
          <div className="grid gap-1">
            <Button type="button" variant="outline" size="sm" onClick={() => imageInput.current?.click()} loading={uploading}>
              <Upload /> {assetFits ? 'Replace image' : 'Upload image'}
            </Button>
            <span className="text-xs text-muted-foreground">PNG, JPG or WEBP, up to 15 MB. It slowly pans and is dimmed slightly behind captions.</span>
          </div>
          <input
            ref={imageInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadImage(f);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {kind === 'video' && (
        <div className="grid gap-2">
          <VideoUploader current={assetFits ? (asset ?? null) : null} onUploaded={(a) => onAsset(a)} />
          <span className="text-xs text-muted-foreground">Its own sound is removed; it loops for the length of the voiceover.</span>
        </div>
      )}
      {(kind === 'image' || kind === 'video') && !assetFits && !uploading && <Notice tone="warning">Add a background {kind} — the video can’t be made without it.</Notice>}
    </div>
  );
}

const LENGTHS = [15, 30, 45, 60, 90];

/** Drafts a script from a topic with AI (free, rate-limited). The user reviews and edits it. */
export function ScriptAssist({
  language,
  style,
  hasScript,
  onScript,
}: {
  language: ProjectSettings['language'];
  style: EditingStyle;
  hasScript: boolean;
  onScript: (script: string, title: string) => void;
}) {
  const { data: meta } = useMeta();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState(45);
  const [notes, setNotes] = useState('');
  const write = useMutation({
    mutationFn: () =>
      api<{ data: { script: string; title: string } }>('/ai/script', {
        method: 'POST',
        body: { topic: topic.trim(), language, durationSec: duration, style, ...(notes.trim() ? { notes: notes.trim() } : {}) },
      }).then((r) => r.data),
    onSuccess: (r) => {
      onScript(r.script, r.title);
      setOpen(false);
      toast.success('Draft written — read it through and edit anything before making the voiceover');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!meta?.features.scriptWriting) return null;
  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setOpen(true)}>
        <Wand2 /> Write it with AI
      </Button>
    );
  }
  return (
    <div className="grid gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <Field id="ai-topic" label="What’s the video about?" hint="One line is enough. The script uses your project’s language and editing style.">
        <Input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} placeholder="e.g. 3 habits that doubled my Instagram reach" autoFocus />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field id="ai-length" label="Length">
          <Select value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))}>
            {LENGTHS.map((l) => (
              <option key={l} value={l}>
                About {l} seconds
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ai-notes" label="Anything to include? (optional)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="e.g. mention my free guide at the end" />
        </Field>
      </div>
      {hasScript && <p className="text-xs text-warning">This replaces the script you have now.</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="gradient" onClick={() => write.mutate()} disabled={topic.trim().length < 3} loading={write.isPending}>
          {!write.isPending && <Sparkles />} {write.isPending ? 'Writing… (up to a minute)' : 'Write script'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={write.isPending}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">AI drafts can contain mistakes — check facts before publishing. Writing a script uses no credits.</p>
    </div>
  );
}
