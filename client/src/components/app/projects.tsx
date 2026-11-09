import { Link } from 'react-router';
import { Clapperboard, UserRound, Wand2 } from 'lucide-react';
import { Badge } from '../ui/primitives';
import { Input, Select } from '../ui/input';
import { Label } from '../ui/primitives';
import { ASPECTS, CAPTION_STYLES, LANGUAGES, MUSIC_MOODS, STATUS_META, STYLES, modeName } from '@/config/options';
import { cn, timeAgo } from '@/lib/utils';
import { useMeta } from '@/lib/queries';
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
  captionSize: 'medium',
  captionLanguage: 'same',
  highlightColor: '#A78BFA',
  musicMood: 'auto',
  bRollIntensity: 'medium',
  editingIntensity: 'medium',
  language: 'en',
  framing: 'auto',
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

type SettingStatus = 'applied' | 'needs_key' | 'soon';
const STATUS_LABEL: Record<SettingStatus, { text: string; variant: 'success' | 'warning' | 'muted' }> = {
  applied: { text: 'Applied', variant: 'success' },
  needs_key: { text: 'Needs transcription key', variant: 'warning' },
  soon: { text: 'Coming soon', variant: 'muted' },
};

/** One setting: label, status chip, the control, and a sentence saying what it changes. */
function Setting({ label, htmlFor, status, help, children }: { label: string; htmlFor?: string; status: SettingStatus; help: string; children: React.ReactNode }) {
  const st = STATUS_LABEL[status];
  return (
    <div className="grid content-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="font-semibold">
            {label}
          </Label>
        ) : (
          <span className="text-sm font-semibold">{label}</span>
        )}
        <Badge variant={st.variant} className="px-2 py-0 text-[10px]">
          {st.text}
        </Badge>
      </div>
      {children}
      <p className="text-xs leading-relaxed text-muted-foreground">{help}</p>
    </div>
  );
}

const INTENSITY: { id: Intensity; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

const FRAMING: { id: ProjectSettings['framing']; label: string; sub: string }[] = [
  { id: 'auto', label: 'Auto', sub: 'Recommended' },
  { id: 'crop', label: 'Fill frame', sub: 'Crops the edges' },
  { id: 'blur', label: 'Blurred background', sub: 'Shows the whole video' },
];

const CAPTION_SIZES: { id: ProjectSettings['captionSize']; label: string }[] = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
  { id: 'xl', label: 'Extra large' },
];

export function CustomizeForm({ value, onChange }: { value: CustomizeValue; onChange: (v: CustomizeValue) => void }) {
  const { data: meta } = useMeta();
  const captionsLive = Boolean(meta?.features.captions);
  // Older projects may predate newer settings; fall back to defaults.
  const s: ProjectSettings = { ...DEFAULT_SETTINGS, ...value.settings };
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => onChange({ ...value, settings: { ...s, [k]: v } });
  const captionStatus: SettingStatus = captionsLive ? 'applied' : 'needs_key';
  const spokenName = LANGUAGES.find((l) => l.id === s.language)?.name ?? s.language;

  return (
    <div className="grid gap-10">
      {/* ── Look & format ── */}
      <section className="grid gap-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Look & format</h3>

        <Setting
          label="Editing style"
          status="soon"
          help="Sets the overall feel — pacing, music and B-roll choices. Saved now; it will shape renders once AI styling launches. Pauses, captions and framing below already apply."
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STYLES.map((st) => (
              <button
                key={st.id}
                type="button"
                aria-pressed={value.style === st.id}
                onClick={() => onChange({ ...value, style: st.id })}
                className={cn('rounded-lg border p-3 text-left transition-colors', value.style === st.id ? 'border-primary bg-primary/15' : 'border-border hover:border-primary/40')}
              >
                <span className="text-sm font-semibold">{st.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{st.blurb}</span>
              </button>
            ))}
          </div>
        </Setting>

        <Setting label="Format" status="applied" help="The shape of the final video. Pick the platform you're posting to.">
          <Choice name="Aspect ratio" value={value.aspectRatio} onChange={(v) => onChange({ ...value, aspectRatio: v })} options={ASPECTS.map((a) => ({ id: a.id, label: a.name, sub: a.platforms }))} />
        </Setting>

        <Setting
          label="Video background (framing)"
          status="applied"
          help="What happens when your footage is a different shape from the format — e.g. a landscape video made vertical. Fill frame zooms in and crops the edges. Blurred background shows the whole video with a soft blurred copy filling the empty space. Auto picks blur only when cropping would cut off a lot."
        >
          <Choice name="Framing" value={s.framing} onChange={(v) => set('framing', v)} options={FRAMING} />
        </Setting>

        <div className="grid gap-6 sm:grid-cols-2">
          <Setting label="Export resolution" htmlFor="resolution" status="applied" help="Sharpness of the downloaded file. Higher looks crisper but makes larger files. Free plan exports up to 720p.">
            <Select id="resolution" value={s.resolution} onChange={(e) => set('resolution', e.target.value as ProjectSettings['resolution'])}>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="4k">4K (Pro plans)</option>
            </Select>
          </Setting>
          <Setting label="Target length (seconds)" htmlFor="duration" status="soon" help="How long you want the finished video. Saved now; AI trimming to a target length comes in a later release.">
            <Input
              id="duration"
              type="number"
              min={5}
              max={3600}
              value={s.targetDurationSec}
              onChange={(e) => set('targetDurationSec', Math.min(3600, Math.max(5, Number(e.target.value) || 5)))}
            />
          </Setting>
        </div>
      </section>

      {/* ── Editing ── */}
      <section className="grid gap-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Editing</h3>
        <div className="grid gap-6 sm:grid-cols-2">
          <Setting
            label="Editing intensity"
            status="applied"
            help="How aggressively pauses are cut. Low keeps natural breathing room; High makes a fast, punchy edit. Medium and High also cut filler words (“um”, “uh”) when transcription is enabled."
          >
            <Choice name="Editing intensity" value={s.editingIntensity} onChange={(v) => set('editingIntensity', v)} options={INTENSITY} />
          </Setting>
          <Setting label="B-roll intensity" status="soon" help="How often relevant stock clips cut in over your footage. Saved now; automatic B-roll comes in the next step.">
            <Choice name="B-roll intensity" value={s.bRollIntensity} onChange={(v) => set('bRollIntensity', v)} options={INTENSITY} />
          </Setting>
          <Setting label="Background music" htmlFor="music" status="soon" help="Music mood under your voice (auto-lowered while you speak). Saved now; needs a licensed music library.">
            <Select id="music" value={s.musicMood} onChange={(e) => set('musicMood', e.target.value as ProjectSettings['musicMood'])}>
              {MUSIC_MOODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Setting>
        </div>
      </section>

      {/* ── Language ── */}
      <section className="grid gap-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Language</h3>
        <div className="grid gap-6 sm:grid-cols-2">
          <Setting
            label="Spoken language (audio)"
            htmlFor="language"
            status={captionStatus}
            help="The language people speak in your video. Used to transcribe the speech accurately for captions and filler-word removal. Choose the language actually spoken."
          >
            <Select id="language" value={s.language} onChange={(e) => set('language', e.target.value as ProjectSettings['language'])}>
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Setting>
          <Setting
            label="Caption language"
            htmlFor="captionLanguage"
            status={captionStatus}
            help={`The language the on-screen captions are written in. “Same as spoken” shows exactly what is said (${spokenName}). Translating captions into another language needs an AI translation key and is coming soon.`}
          >
            <Select id="captionLanguage" value={s.captionLanguage} onChange={(e) => set('captionLanguage', e.target.value as ProjectSettings['captionLanguage'])}>
              <option value="same">Same as spoken ({spokenName})</option>
              {LANGUAGES.filter((l) => l.id !== s.language).map((l) => (
                <option key={l.id} value={l.id} disabled>
                  {l.name} — translation coming soon
                </option>
              ))}
            </Select>
          </Setting>
        </div>
      </section>

      {/* ── Captions ── */}
      <section className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Captions</h3>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={s.captionsEnabled} onChange={(e) => set('captionsEnabled', e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
            Add captions
          </label>
        </div>
        {!captionsLive && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
            Captions are created from a transcript of your audio. Transcription isn’t enabled on this server yet, so these settings are saved and will apply once it is.
          </p>
        )}
        {s.captionsEnabled && (
          <div className="grid gap-6 sm:grid-cols-2">
            <Setting label="Caption style" htmlFor="captionStyle" status={captionStatus} help="How captions look and animate. Bold pop: big words that pop in. Karaoke: words light up as they're spoken. Boxed: text on a dark box. Clean: small and subtle. Cinematic: spaced capitals that fade.">
              <Select id="captionStyle" value={s.captionStyle} onChange={(e) => set('captionStyle', e.target.value as ProjectSettings['captionStyle'])}>
                {CAPTION_STYLES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Setting>
            <Setting label="Caption text size" status={captionStatus} help="How big the caption text is. Larger text is easier to read on phones but fits fewer words per line.">
              <Choice name="Caption text size" value={s.captionSize} onChange={(v) => set('captionSize', v)} options={CAPTION_SIZES} />
            </Setting>
            <Setting label="Caption position" htmlFor="captionPosition" status={captionStatus} help="Where captions sit on screen. Bottom stays clear of faces; Top or Middle can avoid on-screen text in your footage.">
              <Select id="captionPosition" value={s.captionPosition} onChange={(e) => set('captionPosition', e.target.value as ProjectSettings['captionPosition'])}>
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </Select>
            </Setting>
            <Setting label="Keyword highlight colour" htmlFor="highlight" status={captionStatus} help="Colour used to emphasise one important word per line — numbers first, otherwise the most meaningful word. In Karaoke style it's the colour words fill with as they're spoken.">
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
            </Setting>
          </div>
        )}
      </section>
    </div>
  );
}
