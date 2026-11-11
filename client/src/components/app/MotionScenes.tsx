import { useMemo, useState } from 'react';
import { Player, Thumbnail } from '@remotion/player';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input, Select, Textarea } from '../ui/input';
import { useBrandKit } from '@/lib/queries';
import { MotionVideo } from '@/motion/MotionVideo';
import { ICONS, MOTION_FPS, TEMPLATES, type IconName, type MotionScene, type MotionTheme, type TemplateId } from '@/motion/types';
import type { AspectRatio, Scene } from '@/types/api';

const SIZE: Record<AspectRatio, [number, number]> = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };

/** Same dark theme the server derives from the Brand Kit, so the preview matches the render. */
export function useMotionTheme(): MotionTheme {
  const { data: kit } = useBrandKit();
  return useMemo(() => {
    const ok = (c: string | undefined, d: string) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d);
    const primary = ok(kit?.primaryColor, '#7C3AED');
    const a = primary.match(/[0-9a-f]{2}/gi)!.map((x) => parseInt(x, 16));
    const b = [5, 5, 10];
    const background = `#${a.map((v, i) => Math.round(v + (b[i]! - v) * 0.9).toString(16).padStart(2, '0')).join('')}`;
    return { primary, secondary: ok(kit?.secondaryColor, '#22D3EE'), background, text: '#FFFFFF', muted: '#A1A1AA' };
  }, [kit?.primaryColor, kit?.secondaryColor]);
}

/** Preview timing: words at speaking pace (the final video follows the real voiceover timing). */
const framesFor = (text: string, language: string) => Math.max(2 * MOTION_FPS, Math.round((text.split(/\s+/).filter(Boolean).length / (language === 'en' ? 2.5 : 2.1)) * MOTION_FPS));

/** Plays the whole explainer in the browser with the same compositions the server renders. */
export function MotionPreview({ scenes, aspect, language }: { scenes: Scene[]; aspect: AspectRatio; language: string }) {
  const theme = useMotionTheme();
  const [w, h] = SIZE[aspect];
  const valid = scenes.filter((s) => s.motion) as Array<Scene & { motion: MotionScene }>;
  const inputProps = useMemo(() => ({ scenes: valid.map((s) => ({ ...s.motion, durationInFrames: framesFor(s.text, language) })), theme }), [valid, theme, language]);
  const total = inputProps.scenes.reduce((t, s) => t + s.durationInFrames, 0);
  if (!valid.length) return null;
  return (
    <div className="grid gap-1.5">
      <div className="mx-auto w-full overflow-hidden rounded-lg border border-border bg-black" style={{ maxWidth: w > h ? 640 : 300 }}>
        <Player component={MotionVideo} inputProps={inputProps} durationInFrames={Math.max(1, total)} fps={MOTION_FPS} compositionWidth={w} compositionHeight={h} style={{ width: '100%', aspectRatio: `${w} / ${h}` }} controls loop acknowledgeRemotionLicense />
      </div>
      <p className="text-center text-[11px] text-muted-foreground">Live preview with estimated timing — in the video each scene lasts exactly as long as its narration.</p>
    </div>
  );
}

/** A still of one scene for its card. */
export function MotionThumb({ scene, aspect }: { scene: Scene; aspect: AspectRatio }) {
  const theme = useMotionTheme();
  const [w, h] = SIZE[aspect];
  if (!scene.motion) return <div className="grid aspect-video w-full place-items-center rounded-md bg-muted text-xs text-muted-foreground">No animation</div>;
  return (
    <Thumbnail
      component={MotionVideo}
      inputProps={{ scenes: [{ ...(scene.motion as MotionScene), durationInFrames: 90 }], theme }}
      compositionWidth={w}
      compositionHeight={h}
      frameToDisplay={60}
      durationInFrames={90}
      fps={MOTION_FPS}
      style={{ width: '100%', borderRadius: 6 }}
    />
  );
}

/** Starting fields when switching a scene to another template (from its narration). */
function defaultsFor(t: TemplateId, text: string): MotionScene {
  const first = (text.match(/^[^.!?।]+/)?.[0] ?? text).trim();
  const short = (n: number) => (first.length > n ? `${first.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : first);
  switch (t) {
    case 'title':
      return { template: 'title', params: { headline: short(60) } };
    case 'statement':
      return { template: 'statement', params: { text: short(120) } };
    case 'stat':
      return { template: 'stat', params: { value: '10x', label: short(60) } };
    case 'bullets':
      return { template: 'bullets', params: { items: ['First point', 'Second point'] } };
    case 'cards':
      return { template: 'cards', params: { cards: [{ icon: 'sparkles', label: 'Idea' }, { icon: 'rocket', label: 'Result' }] } };
    case 'process':
      return { template: 'process', params: { steps: [{ icon: 'lightbulb', label: 'Idea' }, { icon: 'cpu', label: 'Process' }, { icon: 'rocket', label: 'Result' }] } };
    case 'compare':
      return { template: 'compare', params: { leftTitle: 'Before', leftPoints: ['Slow'], rightTitle: 'After', rightPoints: ['Fast'] } };
    case 'chat':
      return { template: 'chat', params: { prompt: short(80), reply: 'Here is the answer…' } };
    case 'orbit':
      return { template: 'orbit', params: { centerIcon: 'sparkles', label: short(40), icons: ['file', 'image', 'video'] } };
    case 'cta':
      return { template: 'cta', params: { headline: 'Want more?', action: 'Follow for more' } };
  }
}

const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);

function IconSelect({ value, onChange, label }: { value: IconName; onChange: (v: IconName) => void; label: string }) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as IconName)} className="h-8 w-32 text-xs">
      {ICONS.map((i) => (
        <option key={i} value={i}>
          {i}
        </option>
      ))}
    </Select>
  );
}

/** Rows of {icon, label} for cards/process (2–4). */
function IconRows({ rows, onChange }: { rows: Array<{ icon: IconName; label: string }>; onChange: (r: Array<{ icon: IconName; label: string }>) => void }) {
  return (
    <div className="grid gap-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-1.5">
          <IconSelect label={`Icon ${i + 1}`} value={r.icon} onChange={(icon) => onChange(rows.map((x, j) => (j === i ? { ...x, icon } : x)))} />
          <Input aria-label={`Label ${i + 1}`} value={r.label} maxLength={24} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="h-8 text-xs" />
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Remove" disabled={rows.length <= 2} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      {rows.length < 4 && (
        <Button size="sm" variant="ghost" className="h-7 justify-self-start" onClick={() => onChange([...rows, { icon: 'star', label: 'New' }])}>
          <Plus /> Add
        </Button>
      )}
    </div>
  );
}

/** Edit a scene's template and fields; the server validates on save. */
export function MotionEditor({ scene, onSave, saving }: { scene: Scene; onSave: (m: MotionScene) => void; saving: boolean }) {
  const [m, setM] = useState<MotionScene>((scene.motion as MotionScene) ?? defaultsFor('statement', scene.text));
  const p = m.params as unknown as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => setM({ ...m, params: { ...p, ...patch } } as unknown as MotionScene);
  const field = (key: string, label: string, max: number, optional = false) => (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">
        {label}
        {optional ? ' (optional)' : ''}
      </span>
      <Input value={String(p[key] ?? '')} maxLength={max} onChange={(e) => set({ [key]: e.target.value || (optional ? undefined : '') })} className="h-8 text-xs" />
    </label>
  );
  const list = (key: string, label: string) => (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label} (one per line)</span>
      <Textarea value={((p[key] as string[]) ?? []).join('\n')} onChange={(e) => set({ [key]: lines(e.target.value) })} rows={3} className="text-xs" />
    </label>
  );

  return (
    <div className="grid gap-2 rounded-md bg-muted/40 p-2">
      <label className="grid gap-1 text-xs">
        <span className="text-muted-foreground">Template</span>
        <Select value={m.template} onChange={(e) => setM(defaultsFor(e.target.value as TemplateId, scene.text))} className="h-8 text-xs">
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {t.use}
            </option>
          ))}
        </Select>
      </label>
      {m.template === 'title' && (
        <>
          {field('eyebrow', 'Small line above', 30, true)}
          {field('headline', 'Headline', 60)}
        </>
      )}
      {m.template === 'statement' && (
        <>
          {field('text', 'Text', 120)}
          {field('highlight', 'Word to highlight', 30, true)}
        </>
      )}
      {m.template === 'stat' && (
        <>
          {field('value', 'Number (e.g. 73%)', 12)}
          {field('label', 'What it means', 60)}
        </>
      )}
      {m.template === 'bullets' && (
        <>
          {field('title', 'Title', 40, true)}
          {list('items', 'Points (2–4)')}
        </>
      )}
      {m.template === 'cards' && (
        <>
          {field('title', 'Title', 40, true)}
          <IconRows rows={(p.cards as Array<{ icon: IconName; label: string }>) ?? []} onChange={(cards) => set({ cards })} />
        </>
      )}
      {m.template === 'process' && <IconRows rows={(p.steps as Array<{ icon: IconName; label: string }>) ?? []} onChange={(steps) => set({ steps })} />}
      {m.template === 'compare' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-2">
            {field('leftTitle', 'Left title', 24)}
            {list('leftPoints', 'Left points (1–3)')}
          </div>
          <div className="grid gap-2">
            {field('rightTitle', 'Right title', 24)}
            {list('rightPoints', 'Right points (1–3)')}
          </div>
        </div>
      )}
      {m.template === 'chat' && (
        <>
          {field('prompt', 'Question typed', 80)}
          {field('reply', 'Answer', 140)}
        </>
      )}
      {m.template === 'orbit' && (
        <>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Centre icon</span>
            <IconSelect label="Centre icon" value={p.centerIcon as IconName} onChange={(centerIcon) => set({ centerIcon })} />
          </div>
          {field('label', 'Label', 40)}
          <div className="flex flex-wrap gap-1">
            {ICONS.map((i) => {
              const on = ((p.icons as string[]) ?? []).includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    const cur = (p.icons as string[]) ?? [];
                    set({ icons: on ? cur.filter((x) => x !== i) : cur.length < 6 ? [...cur, i] : cur });
                  }}
                  className={`rounded px-1.5 py-0.5 text-[11px] ${on ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}
                >
                  {i}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">Pick 3–6 orbiting icons.</p>
        </>
      )}
      {m.template === 'cta' && (
        <>
          {field('headline', 'Headline', 50)}
          {field('action', 'Button text', 30)}
        </>
      )}
      <Button size="sm" className="justify-self-start" onClick={() => onSave(m)} loading={saving}>
        Save animation
      </Button>
    </div>
  );
}
