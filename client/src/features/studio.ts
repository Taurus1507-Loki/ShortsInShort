import type { Meta, PriceStep, Project, ProjectMode } from '@/types/api';

/**
 * Making a video is a series of pages, one per step: /app/projects/:id/:step. Each step saves the
 * project, and each step that costs money says what it costs before anything is charged.
 */
export type StudioStep = 'footage' | 'edit' | 'script' | 'voice' | 'scenes' | 'presenter' | 'style' | 'export';

export interface StepInfo {
  id: StudioStep;
  label: string;
  /** What this page is for, shown under its title. */
  blurb: string;
  /** Must be finished before Continue (the video can't be made without it). */
  required: boolean;
}

const STEP: Record<StudioStep, StepInfo> = {
  footage: { id: 'footage', label: 'Footage', blurb: 'The raw video the AI editor works from.', required: true },
  edit: { id: 'edit', label: 'Edit', blurb: 'AI finds the pauses and filler words; you cut, restore, zoom and add text on the timeline while the player shows the result.', required: true },
  script: { id: 'script', label: 'Script', blurb: 'What the voice will say, word for word. Write it yourself or let AI write it.', required: true },
  voice: { id: 'voice', label: 'Voice', blurb: 'Pick a voice, generate the voiceover and listen to it.', required: true },
  scenes: { id: 'scenes', label: 'Scenes', blurb: 'One clip or animation per scene, playing exactly while its words are spoken. Swap any of them.', required: true },
  presenter: { id: 'presenter', label: 'Presenter', blurb: 'An optional talking presenter, and the background behind the video.', required: false },
  style: { id: 'style', label: 'Style', blurb: 'Captions, format, music and branding for the finished video.', required: false },
  export: { id: 'export', label: 'Export', blurb: 'Make the final video, watch it and download it.', required: false },
};

export const FLOWS: Record<ProjectMode, StudioStep[]> = {
  faceless: ['script', 'voice', 'scenes', 'style', 'export'],
  avatar: ['script', 'voice', 'presenter', 'style', 'export'],
  editor: ['footage', 'edit', 'style', 'export'],
};

export const stepsFor = (mode: ProjectMode) => FLOWS[mode].map((id) => STEP[id]);

/** The voiceover no longer matches the saved script or voice. */
export function voiceOutdated(p: Project) {
  const s = p.narrationStats;
  return !s || s.voiceId !== p.settings.voiceId || s.characters !== p.script.trim().length;
}

/** Whether a step is finished, from the saved project (unsaved edits don't count). */
export function stepDone(p: Project, step: StudioStep): boolean {
  switch (step) {
    case 'footage':
      return Boolean(p.sourceAssetId);
    case 'edit':
      return Boolean(p.edit && p.edit.sourceAssetId === p.sourceAssetId);
    case 'script':
      return p.script.trim().length > 0 && p.script.trim().length <= 5000;
    case 'voice':
      return Boolean(p.narrationAssetId) && !voiceOutdated(p);
    case 'scenes': {
      const scenes = p.scenes ?? [];
      const motion = p.settings.facelessStyle === 'motion';
      return scenes.length > 0 && !p.scenesOutdated && scenes.every((sc) => (motion ? Boolean(sc.motion) : Boolean(sc.clip || sc.assetId)));
    }
    case 'export':
      return p.status === 'completed' && Boolean(p.outputAsset);
    default:
      // Settings pages are optional: finished once a video has been made with them.
      return Boolean(p.outputAsset);
  }
}

/** Why Continue is blocked on a required step, or null. */
export function stepBlocker(p: Project, step: StudioStep): string | null {
  if (stepDone(p, step) || !STEP[step].required) return null;
  switch (step) {
    case 'footage':
      return 'Upload your video to continue.';
    case 'edit':
      return 'Analyse the video to continue.';
    case 'script':
      return p.script.trim().length > 5000 ? 'Shorten the script to 5,000 characters or fewer.' : 'Write or generate a script to continue.';
    case 'voice':
      return p.narrationAssetId ? 'Your script or voice changed: generate the voiceover again to continue.' : 'Generate the voiceover to continue.';
    case 'scenes':
      return p.scenesOutdated ? 'The script changed: re-plan the scenes to continue.' : 'Plan the scenes (free) and give every scene a clip to continue.';
    default:
      return null;
  }
}

/** Where to open a project: the first unfinished required step, else the export page or the first optional page. */
export function resumeStep(p: Project): StudioStep {
  const flow = FLOWS[p.mode];
  const pending = flow.find((id) => STEP[id].required && !stepDone(p, id));
  if (pending) return pending;
  if (p.outputAsset || p.status === 'queued' || p.status === 'processing' || p.status === 'failed') return 'export';
  return flow.find((id) => !STEP[id].required) ?? 'export';
}

/** The price shown on a step: "Free", "2 credits / 30 s"… */
export function stepPrice(meta: Meta | undefined, p: Pick<Project, 'mode' | 'settings'> & { edit?: Project['edit'] }, step: StudioStep): { text: string; free: boolean } {
  const price = (id: PriceStep) => meta?.pricing.find((x) => x.step === id);
  const fmt = (id: PriceStep, prefix = '') => {
    const x = price(id);
    if (!x) return { text: prefix || 'Priced before you confirm', free: false };
    return { text: `${prefix}${x.credits} credit${x.credits === 1 ? '' : 's'} ${x.unit}`, free: false };
  };
  switch (step) {
    case 'voice':
      return fmt('voice');
    case 'presenter':
      return fmt('presenter', 'Optional · presenter ');
    case 'edit':
      return fmt('editor_analyze', 'Once · ');
    case 'export':
      if (p.mode === 'editor') return fmt(p.edit ? 'editor_rerender' : 'editor');
      return fmt(p.mode === 'faceless' && p.settings.facelessStyle === 'motion' ? 'export_motion' : 'export');
    default:
      return { text: 'Free', free: true };
  }
}
