import { Link } from 'react-router';
import { Clapperboard, UserRound, Wand2 } from 'lucide-react';
import { Badge } from '../ui/primitives';
import { Input, Select } from '../ui/input';
import { Label } from '../ui/primitives';
import { ASPECTS, CAPTION_STYLES, LANGUAGES, MUSIC_MOODS, STATUS_META, STYLES, modeName } from '@/config/options';
import { cn, timeAgo } from '@/lib/utils';
import type { AspectRatio, EditingStyle, Intensity, Project, ProjectMode, ProjectSettings } from '@/types/api';

const MODE_ICON: Record<ProjectMode, typeof Wand2> = { editor: Wand2, avatar: UserRound, faceless: Clapperboard };

const ASPECT_BOX: Record<AspectRatio, string> = { '9:16': 'h-12 w-7', '16:9': 'h-7 w-12', '1:1': 'h-10 w-10', '4:5': 'h-11 w-9' };

export function StatusBadge({ status }: { status: Project['status'] }) {
  const m = STATUS_META[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function ProjectRow({ project }: { project: Project }) {
  const Icon = MODE_ICON[project.mode];
  return (
    <Link
      to={`/app/projects/${project.id}`}
      className="flex items-center gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-muted/50"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-highlight">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{project.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {modeName(project.mode)} · {project.aspectRatio} · edited {timeAgo(project.updatedAt)}
        </p>
      </div>
      <StatusBadge status={project.status} />
    </Link>
  );
}

export function ProjectCard({ project }: { project: Project }) {
  const Icon = MODE_ICON[project.mode];
  return (
    <Link
      to={`/app/projects/${project.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40"
    >
      <div className="relative grid aspect-video place-items-center bg-gradient-to-br from-primary/20 via-card to-accent/15">
        <div className={cn('rounded-md border-2 border-foreground/25', ASPECT_BOX[project.aspectRatio])} aria-hidden />
        <span className="absolute left-3 top-3">
          <StatusBadge status={project.status} />
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="truncate font-semibold group-hover:text-highlight">{project.title}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {modeName(project.mode)} · {project.aspectRatio}
        </p>
        <p className="mt-auto pt-2 text-xs text-muted-foreground">Edited {timeAgo(project.updatedAt)}</p>
      </div>
    </Link>
  );
}

/* ── Customize form (shared by the wizard and the project page) ─────── */

export interface CustomizeValue {
  style: EditingStyle;
  aspectRatio: AspectRatio;
  settings: ProjectSettings;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  captionsEnabled: true,
  captionStyle: 'bold_pop',
  captionPosition: 'bottom',
  highlightColor: '#A78BFA',
  musicMood: 'auto',
  bRollIntensity: 'medium',
  editingIntensity: 'medium',
  language: 'en',
  targetDurationSec: 60,
  resolution: '1080p',
};

function Choice<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: { id: T; label: string; sub?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
            value === o.id ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
          )}
        >
          <span className="font-semibold">{o.label}</span>
          {o.sub && <span className="block text-xs text-muted-foreground">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

const INTENSITY: { id: Intensity; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

export function CustomizeForm({ value, onChange }: { value: CustomizeValue; onChange: (v: CustomizeValue) => void }) {
  const s = value.settings;
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => onChange({ ...value, settings: { ...s, [k]: v } });

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Editing style</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STYLES.map((st) => (
            <button
              key={st.id}
              type="button"
              aria-pressed={value.style === st.id}
              onClick={() => onChange({ ...value, style: st.id })}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                value.style === st.id ? 'border-primary bg-primary/15' : 'border-border hover:border-primary/40',
              )}
            >
              <span className="text-sm font-semibold">{st.name}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{st.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Format</h3>
        <Choice
          name="Aspect ratio"
          value={value.aspectRatio}
          onChange={(v) => onChange({ ...value, aspectRatio: v })}
          options={ASPECTS.map((a) => ({ id: a.id, label: a.name, sub: a.platforms }))}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="language">Language</Label>
          <Select id="language" value={s.language} onChange={(e) => set('language', e.target.value as ProjectSettings['language'])}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="music">Music</Label>
          <Select id="music" value={s.musicMood} onChange={(e) => set('musicMood', e.target.value as ProjectSettings['musicMood'])}>
            {MUSIC_MOODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="duration">Target duration (seconds)</Label>
          <Input
            id="duration"
            type="number"
            min={5}
            max={3600}
            value={s.targetDurationSec}
            onChange={(e) => set('targetDurationSec', Math.min(3600, Math.max(5, Number(e.target.value) || 5)))}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="resolution">Export resolution</Label>
          <Select id="resolution" value={s.resolution} onChange={(e) => set('resolution', e.target.value as ProjectSettings['resolution'])}>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="4k">4K (Pro plans, where supported)</option>
          </Select>
        </div>
      </section>

      <section className="grid gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Captions</h3>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.captionsEnabled} onChange={(e) => set('captionsEnabled', e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
            Enabled
          </label>
        </div>
        {s.captionsEnabled && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="captionStyle">Style</Label>
              <Select id="captionStyle" value={s.captionStyle} onChange={(e) => set('captionStyle', e.target.value as ProjectSettings['captionStyle'])}>
                {CAPTION_STYLES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="captionPosition">Position</Label>
              <Select id="captionPosition" value={s.captionPosition} onChange={(e) => set('captionPosition', e.target.value as ProjectSettings['captionPosition'])}>
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="highlight">Keyword highlight</Label>
              <div className="flex gap-2">
                <input
                  id="highlight"
                  type="color"
                  value={s.highlightColor}
                  onChange={(e) => set('highlightColor', e.target.value.toUpperCase())}
                  className="h-10 w-12 cursor-pointer rounded-lg border border-input bg-transparent p-1"
                  aria-label="Highlight colour"
                />
                <Input value={s.highlightColor} readOnly aria-label="Highlight colour hex" />
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <span className="text-sm font-semibold">B-roll intensity</span>
          <Choice name="B-roll intensity" value={s.bRollIntensity} onChange={(v) => set('bRollIntensity', v)} options={INTENSITY} />
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-semibold">Editing intensity</span>
          <Choice name="Editing intensity" value={s.editingIntensity} onChange={(v) => set('editingIntensity', v)} options={INTENSITY} />
        </div>
      </section>
    </div>
  );
}
