import { Project, type ProjectDoc } from '../../models/Project.js';
import { Asset } from '../../models/Asset.js';
import type { JobDoc, JobType } from '../../models/Job.js';
import { narrationCreditCost, reelCost } from '../../config/credits.js';
import { parseMotionScene } from '../faceless/motion.js';
import { onJobFinished } from '../queue/worker.js';
import { startJob } from '../projectJobs.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../utils/errors.js';

/**
 * Batch autopilot: a batch video runs voiceover → scene planning → export by itself. When one step's
 * job finishes, the next one starts and is charged exactly like the step pages charge it. A failed
 * step, a scene without a clip or too few credits stops that video (the others carry on) with a note
 * saying what to do; the user can always open the project and finish it by hand.
 */

const STEPS: JobType[] = ['narrate_project', 'plan_scenes', 'render_project'];

/** Typical speaking pace, for estimates before the voiceover exists. */
export const WORDS_PER_SEC = 2.5;

/** Credits a batch video is expected to cost: voiceover now, export once the voiceover's length is known. */
export function estimateVideo(script: string, opts: { motion: boolean; resolution: string }) {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  const durationSec = Math.max(5, words / WORDS_PER_SEC);
  const narration = narrationCreditCost(script.trim().length);
  // One flat price per reel: the voiceover is charged first and deducted from the export.
  const total = Math.max(narration, reelCost(durationSec, opts.resolution));
  void opts.motion;
  return { durationSec: Math.round(durationSec), narration, export: total - narration, total };
}

async function stop(project: ProjectDoc, error: string) {
  await Project.updateOne({ _id: project._id }, { $set: { 'autopilot.state': 'stopped', 'autopilot.error': error.slice(0, 300) } });
}

/** Starts the step after `finished` for a batch video. */
export async function continueAutopilot(project: ProjectDoc, finished: JobType) {
  const base = { workspaceId: project.workspaceId, actorId: project.createdBy, project };
  try {
    if (finished === 'narrate_project') {
      await startJob({ ...base, type: 'plan_scenes', credits: 0, note: 'Plan scenes (batch)', payload: { previousStatus: project.status } });
      return;
    }
    if (finished === 'plan_scenes') {
      const motion = project.settings?.facelessStyle === 'motion';
      const missing = (project.scenes ?? []).findIndex((sc) => (motion ? !parseMotionScene(sc.motion) : !sc.clip?.id && !sc.assetId));
      if (!project.scenes?.length || missing >= 0) {
        await stop(project, motion ? `Scene ${missing + 1} has no animation. Open the video to fix it, then export.` : `No stock clip was found for scene ${missing + 1}. Open the video, pick a clip, then export.`);
        return;
      }
      const narration = project.narrationAssetId ? await Asset.findById(project.narrationAssetId).select('durationSec').lean() : null;
      const durationSec = narration?.durationSec ?? project.narrationStats?.durationSec ?? 0;
      const resolution = project.settings?.resolution ?? '1080p';
      const credits = Math.max(0, reelCost(durationSec, resolution) - (project.narrationStats?.creditsCharged ?? 0));
      await startJob({ ...base, type: 'render_project', credits, note: 'Render (batch)' });
      return;
    }
    if (finished === 'render_project') {
      await Project.updateOne({ _id: project._id }, { $set: { 'autopilot.state': 'done', 'autopilot.error': null } });
    }
  } catch (err) {
    const msg = err instanceof AppError && err.code === 'INSUFFICIENT_CREDITS' ? 'Not enough credits for the next step. Top up, then open the video to continue.' : err instanceof Error ? err.message : 'The next step could not start.';
    logger.warn({ err, projectId: project._id.toString() }, 'Batch autopilot stopped');
    await stop(project, msg);
  }
}

export function registerAutopilot() {
  onJobFinished(async (job: JobDoc, outcome) => {
    if (!job.projectId || !STEPS.includes(job.type as JobType)) return;
    const project = await Project.findOne({ _id: job.projectId, deletedAt: null });
    // Only the job that last ran for this project moves it on (a stopped or replaced job never does).
    if (!project || project.autopilot?.state !== 'running' || !project.lastJobId?.equals(job._id)) return;
    if (outcome === 'dead') return stop(project, project.lastError ?? 'A step failed. Open the video to try again.');
    await continueAutopilot(project, job.type as JobType);
  });
}
