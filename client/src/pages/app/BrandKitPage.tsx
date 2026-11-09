import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Save, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/app/AppLayout';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Label, Notice, Skeleton } from '@/components/ui/primitives';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useAssetUrl, useBrandKit } from '@/lib/queries';
import { uploadVideo } from '@/lib/upload';
import { CAPTION_STYLES } from '@/config/options';
import { cn } from '@/lib/utils';
import type { BrandKit, LogoPosition } from '@/types/api';

type Draft = Omit<BrandKit, 'logo' | 'updatedAt'> & { logoAssetId: string | null };

const POSITIONS: { id: LogoPosition; label: string }[] = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
];
const LOGO_W = { small: 0.12, medium: 0.18, large: 0.25 } as const;

function Colour({ id, label, value, onChange, help }: { id: string; label: string; value: string; onChange: (v: string) => void; help: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className="font-semibold">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-10 w-12 cursor-pointer rounded-lg border border-input bg-transparent p-1" />
        <code className="text-sm">{value}</code>
      </div>
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

/** Live mock of where the logo and captions land on a 9:16 frame. */
function Preview({ draft, logoUrl }: { draft: Draft; logoUrl?: string }) {
  const corner = {
    'top-left': 'left-[4%] top-[4%]',
    'top-right': 'right-[4%] top-[4%]',
    'bottom-left': 'left-[4%] bottom-[4%]',
    'bottom-right': 'right-[4%] bottom-[4%]',
  }[draft.logoPosition];
  const captionY = { top: 'top-[12%]', middle: 'top-1/2 -translate-y-1/2', bottom: 'bottom-[22%]' }[draft.captionPosition];
  const captionScale = { small: 0.8, medium: 1, large: 1.2, xl: 1.4 }[draft.captionSize];
  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[240px] overflow-hidden rounded-xl border border-border bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900" aria-label="Brand Kit preview">
      <div className="absolute bottom-0 left-1/2 h-[55%] w-[70%] -translate-x-1/2 rounded-t-full bg-white/10" />
      <div className="absolute left-1/2 top-[25%] h-[20%] w-[35%] -translate-x-1/2 rounded-full bg-white/10" />
      {logoUrl && <img src={logoUrl} alt="" className={cn('absolute h-auto', corner)} style={{ width: `${LOGO_W[draft.logoSize] * 100}%`, opacity: draft.logoOpacity }} />}
      <div className={cn('absolute inset-x-3 text-center', captionY)}>
        <span
          className={cn('font-display font-extrabold uppercase text-white', draft.captionStyle === 'boxed' && 'rounded bg-black/70 px-1.5 py-0.5 normal-case', draft.captionStyle === 'clean_minimal' && 'font-semibold normal-case')}
          style={{ fontSize: `${13 * captionScale}px`, textShadow: '0 1px 3px #000' }}
        >
          Your <span style={{ color: draft.highlightColor }}>brand</span> here
        </span>
      </div>
    </div>
  );
}

export default function BrandKitPage() {
  const { workspace } = useAuth();
  const { data: kit, isLoading, isError, error } = useBrandKit();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [logo, setLogo] = useState<BrandKit['logo']>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoUrl = useAssetUrl(logo?.id);

  useEffect(() => {
    if (!kit) return;
    const { logo: l, updatedAt: _u, ...rest } = kit;
    setDraft({ ...rest, logoAssetId: l?.id ?? null });
    setLogo(l);
  }, [kit]);

  const save = useMutation({
    mutationFn: (d: Draft) => api<{ data: BrandKit }>('/brand-kit', { method: 'PUT', body: d }).then((r) => r.data),
    onSuccess: (k) => {
      queryClient.setQueryData(keys.brandKit, k);
      toast.success('Brand Kit saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  async function onLogo(file: File) {
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) return toast.error('Choose a PNG, JPG or WEBP image.');
    if (file.size > 5 * 1024 * 1024) return toast.error('Logos can be up to 5 MB.');
    setUploading(true);
    try {
      const asset = await uploadVideo(file, { purpose: 'logo' });
      setLogo(asset);
      setDraft((d) => (d ? { ...d, logoAssetId: asset.id } : d));
      queryClient.invalidateQueries({ queryKey: keys.me });
      toast.success('Logo uploaded — save to apply it');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  if (isLoading || !draft) {
    return isError ? <Notice tone="error">{errorMessage(error)}</Notice> : <Skeleton className="h-96 rounded-xl" />;
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Brand Kit"
        description="Your logo, colours and caption look — applied automatically so every video is on-brand."
        actions={
          <Button variant="gradient" loading={save.isPending} onClick={() => save.mutate(draft)}>
            <Save /> Save Brand Kit
          </Button>
        }
      />
      {workspace?.plan === 'free' && (
        <Notice tone="info" className="mb-6">
          Free plan exports also show a small “Made with ShortsInShort” mark in the top-right corner. Paid plans remove it.
        </Notice>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Logo</CardTitle>
              <CardDescription>Shown in a corner for the whole video on every render (you can turn it off per project). PNG with a transparent background works best.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="grid h-20 w-32 place-items-center overflow-hidden rounded-lg border border-dashed border-border bg-[repeating-conic-gradient(#8881_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : logoUrl.data ? <img src={logoUrl.data} alt="Your logo" className="max-h-16 max-w-28 object-contain" /> : <ImagePlus className="h-6 w-6 text-muted-foreground" />}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <ImagePlus /> {logo ? 'Replace logo' : 'Upload logo'}
                  </Button>
                  {logo && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setLogo(null);
                        set('logoAssetId', null);
                      }}
                    >
                      <Trash2 /> Remove
                    </Button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="Choose logo image" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onLogo(f); }} />
              </div>
              <div className="grid gap-5 sm:grid-cols-3">
                <div className="grid gap-2">
                  <span className="text-sm font-semibold">Corner</span>
                  <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Logo corner">
                    {POSITIONS.map((p) => (
                      <button key={p.id} type="button" role="radio" aria-checked={draft.logoPosition === p.id} onClick={() => set('logoPosition', p.id)} className={cn('rounded-md border px-2 py-1.5 text-xs', draft.logoPosition === p.id ? 'border-primary bg-primary/15' : 'border-border')}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid content-start gap-2">
                  <Label htmlFor="logoSize" className="font-semibold">Size</Label>
                  <Select id="logoSize" value={draft.logoSize} onChange={(e) => set('logoSize', e.target.value as Draft['logoSize'])}>
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </Select>
                </div>
                <div className="grid content-start gap-2">
                  <Label htmlFor="logoOpacity" className="font-semibold">Opacity · {Math.round(draft.logoOpacity * 100)}%</Label>
                  <input id="logoOpacity" type="range" min={0.2} max={1} step={0.05} value={draft.logoOpacity} onChange={(e) => set('logoOpacity', Number(e.target.value))} className="accent-[hsl(var(--primary))]" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Brand colours</CardTitle>
              <CardDescription>Used as defaults across your videos.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-3">
              <Colour id="primary" label="Primary" value={draft.primaryColor} onChange={(v) => set('primaryColor', v)} help="Your main brand colour." />
              <Colour id="secondary" label="Secondary" value={draft.secondaryColor} onChange={(v) => set('secondaryColor', v)} help="An accent colour." />
              <Colour id="highlight" label="Caption highlight" value={draft.highlightColor} onChange={(v) => set('highlightColor', v)} help="Colour of the emphasised word in captions." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Default caption look</CardTitle>
              <CardDescription>New projects start with these caption settings (you can still change them per project).</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="cs" className="font-semibold">Style</Label>
                <Select id="cs" value={draft.captionStyle} onChange={(e) => set('captionStyle', e.target.value as Draft['captionStyle'])}>
                  {CAPTION_STYLES.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cp" className="font-semibold">Position</Label>
                <Select id="cp" value={draft.captionPosition} onChange={(e) => set('captionPosition', e.target.value as Draft['captionPosition'])}>
                  <option value="top">Top</option>
                  <option value="middle">Middle</option>
                  <option value="bottom">Bottom</option>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="csz" className="font-semibold">Text size</Label>
                <Select id="csz" value={draft.captionSize} onChange={(e) => set('captionSize', e.target.value as Draft['captionSize'])}>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                  <option value="xl">Extra large</option>
                </Select>
              </div>
              <label className="flex items-start gap-2 text-sm sm:col-span-3">
                <input type="checkbox" checked={draft.applyToNewProjects} onChange={(e) => set('applyToNewProjects', e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                <span>
                  <span className="font-semibold">Apply to new projects automatically</span>
                  <span className="block text-xs text-muted-foreground">New projects start with these caption settings and the caption highlight colour.</span>
                </span>
              </label>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">Custom fonts and intro/outro clips are planned for a later release.</p>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preview</p>
          <Preview draft={draft} logoUrl={logoUrl.data} />
          <p className="mt-2 text-center text-xs text-muted-foreground">Approximate placement on a 9:16 video.</p>
        </div>
      </div>
    </div>
  );
}
