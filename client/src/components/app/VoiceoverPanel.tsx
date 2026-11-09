import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Coins, Download, Loader2, Mic, RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';
import { Select } from '../ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Notice } from '../ui/primitives';
import { VoicePicker } from './VoicePicker';
import { api, ApiError, errorMessage } from '@/lib/api';
import { keys, queryClient, useAssetUrl, useJob, useMeta, useNarrationEstimate } from '@/lib/queries';
import { formatDuration } from '@/lib/upload';
import { LANGUAGES } from '@/config/options';
import type { Project, ProjectSettings } from '@/types/api';

const STAGES: Record<string, string> = {
  queued: 'Waiting in queue',
  starting: 'Starting',
  'generating voice': 'Generating the voice',
  'finishing audio': 'Joining and balancing the audio',
  saving: 'Saving your voiceover',
  retrying: 'Hit a snag — retrying',
};

const RATES = [
  { v: 0.85, label: 'Slower (0.85×)' },
  { v: 1, label: 'Normal (1×)' },
  { v: 1.1, label: 'Faster (1.1×)' },
  { v: 1.2, label: 'Fastest (1.2×)' },
];

/**
 * Avatar Studio step 3.1: script → AI voiceover. Voice, language and speed live in the project
 * settings; unsaved edits are saved before generating so the voiceover always matches what you see.
 */
export function VoiceoverPanel({
  project,
  settings,
  onSettingsChange,
  dirty,
  saveFirst,
  scriptLength,
}: {
  project: Project;
  settings: ProjectSettings;
  onSettingsChange: (s: ProjectSettings) => void;
  dirty: boolean;
  saveFirst: () => Promise<Project>;
  scriptLength: number;
}) {
  const { data: meta } = useMeta();
  const live = Boolean(meta?.features.voices);
  const busy = project.status === 'queued' || project.status === 'processing';
  const estimate = useNarrationEstimate(project.id, live && !busy && !dirty && project.script.trim().length > 0);
  const job = useJob(project.id, busy);
  const audioUrl = useAssetUrl(project.narrationAsset?.id);
  const downloadUrl = useAssetUrl(project.narrationAsset?.id, true);
  const [voiceName, setVoiceName] = useState<string | null>(null);

  useEffect(() => {
    if (project.status === 'completed' || project.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: keys.me });
      queryClient.invalidateQueries({ queryKey: keys.dashboard });
    }
  }, [project.status]);

  const narrate = useMutation({
    mutationFn: async () => {
      if (dirty) await saveFirst();
      return api<{ data: { credits: number } }>(`/projects/${project.id}/narrate`, { method: 'POST' });
    },
    onSuccess: (r) => {
      toast.success(`Generating voiceover · ${r.data.credits} credit${r.data.credits === 1 ? '' : 's'} used`);
      queryClient.invalidateQueries({ queryKey: keys.project(project.id) });
      queryClient.invalidateQueries({ queryKey: keys.job(project.id) });
      queryClient.invalidateQueries({ queryKey: keys.me });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_CREDITS') toast.error('Not enough credits for this voiceover.');
      else toast.error(errorMessage(e));
    },
  });

  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => onSettingsChange({ ...settings, [k]: v });
  const stats = project.narrationStats;
  const tooLong = scriptLength > 5000;
  // Cost for the current text (estimated locally while unsaved; the server quote is authoritative).
  const credits = !dirty && estimate.data ? estimate.data.credits : Math.max(1, Math.ceil(scriptLength / 400));
  const balance = estimate.data?.balance;
  const blocker = !live
    ? 'AI voices aren’t configured.'
    : scriptLength === 0
      ? 'Write a script first.'
      : tooLong
        ? 'Scripts can be up to 5,000 characters for one voiceover.'
        : !settings.voiceId
          ? 'Choose a voice below.'
          : null;
  const outdated = stats && !busy && (dirty || stats.voiceId !== settings.voiceId || stats.characters !== project.script.trim().length);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-primary" /> AI voiceover
        </CardTitle>
        <CardDescription className="mt-1.5">
          Turns your script into natural speech with word-level timing (used for captions when the full avatar video arrives). The talking-presenter video itself needs an avatar provider — coming in step 3.4.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {busy && (
          <div className="grid gap-2 rounded-lg border border-border p-4" aria-live="polite">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              {STAGES[job.data?.stage ?? 'queued'] ?? 'Working'}…
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${job.data?.progress ?? 2}%` }} />
            </div>
          </div>
        )}

        {project.status === 'failed' && project.lastError && !busy && (
          <Notice tone="error" title="The last voiceover failed">
            {project.lastError}
          </Notice>
        )}

        {project.narrationAsset && stats && !busy && (
          <div className="grid gap-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {stats.voiceName} · {formatDuration(stats.durationSec)} · {LANGUAGES.find((l) => l.id === stats.language)?.name ?? stats.language}
              </p>
              {downloadUrl.data && (
                <Button asChild size="sm" variant="outline">
                  <a href={downloadUrl.data}>
                    <Download /> Download MP3
                  </a>
                </Button>
              )}
            </div>
            {audioUrl.data ? <audio controls src={audioUrl.data} className="w-full" preload="metadata" /> : <div className="h-10 rounded bg-muted" />}
            <p className="text-xs text-muted-foreground">
              {stats.characters.toLocaleString()} characters · {stats.creditsCharged} credit{stats.creditsCharged === 1 ? '' : 's'} ·{' '}
              {stats.timingsAvailable ? `${stats.wordCount} words timed for captions` : 'word timings not returned for this language'}
            </p>
            {outdated && (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> Your script or voice changed since this voiceover was made — generate again to update it.
              </p>
            )}
          </div>
        )}

        <fieldset disabled={busy} className="grid gap-6 disabled:opacity-60">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="vo-language" label="Spoken language" hint="The language your script is written in. Telugu and Marathi use ElevenLabs’ newer v3 model.">
              <Select value={settings.language} onChange={(e) => set('language', e.target.value as ProjectSettings['language'])}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="vo-rate" label="Speaking speed" hint="How fast the voice talks. Normal suits most shorts.">
              <Select value={String(settings.speakingRate ?? 1)} onChange={(e) => set('speakingRate', Number(e.target.value))}>
                {RATES.map((r) => (
                  <option key={r.v} value={r.v}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Voice{voiceName ? `: ${voiceName}` : ''}</span>
            <VoicePicker
              compact
              value={settings.voiceId}
              onChange={(v) => {
                setVoiceName(v.name);
                set('voiceId', v.id);
              }}
            />
          </div>
        </fieldset>

        <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Coins className="h-4 w-4" />
            {scriptLength > 0 ? (
              <span>
                Costs <strong className="text-foreground">{credits} credit{credits === 1 ? '' : 's'}</strong> (1 per started 400 characters)
                {balance !== undefined ? ` · you have ${balance}` : ''}
              </span>
            ) : (
              'Cost appears once you write a script.'
            )}
          </p>
          <Button variant="gradient" onClick={() => narrate.mutate()} loading={narrate.isPending} disabled={Boolean(blocker) || busy} title={blocker ?? undefined}>
            {stats ? <RotateCcw /> : <Mic />} {dirty ? 'Save & generate voiceover' : stats ? 'Generate again' : 'Generate voiceover'}
          </Button>
        </div>
        {blocker && live && <p className="-mt-3 text-right text-xs text-muted-foreground">{blocker}</p>}
      </CardContent>
    </Card>
  );
}
