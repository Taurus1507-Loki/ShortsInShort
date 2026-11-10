import { logger } from '../../config/logger.js';
import { Project } from '../../models/Project.js';
import type { JobDoc } from '../../models/Job.js';
import { PermanentJobError } from '../queue/queue.js';
import { registerHandler, type JobContext } from '../queue/worker.js';
import { getLLMProvider } from '../ai/llm.js';
import { getStockProvider, type StockClip } from '../ai/stock.js';
import { findClips, planSceneQueries, scenesKey, splitScenes, fallbackQuery } from './scenes.js';

export interface PlanPayload {
  projectId: string;
  credits: number;
  previousStatus: string;
}

const wps = (language: string) => (language === 'en' ? 2.5 : 2.1);

/** Plans scenes for a faceless project: split script → AI searches → best licensed clip per scene. */
async function run({ job, signal, progress }: JobContext) {
  const { projectId, previousStatus } = job.payload as PlanPayload;
  const project = await Project.findOne({ _id: projectId, workspaceId: job.workspaceId, deletedAt: null });
  if (!project) throw new PermanentJobError('The project no longer exists.');
  const stock = getStockProvider();
  if (!stock) throw new PermanentJobError('Stock footage search is not configured on this server.');
  const script = (project.script ?? '').trim();
  const language = project.settings?.language ?? 'en';
  const drafts = splitScenes(script, language);
  if (!drafts.length) throw new PermanentJobError('Write a script first.');
  await Project.updateOne({ _id: project._id }, { $set: { status: 'processing', lastError: null } });

  await progress(10, 'planning_scenes');
  const llm = getLLMProvider();
  let queries: string[][];
  let plannedWith: 'ai' | 'keywords' = llm ? 'ai' : 'keywords';
  try {
    queries = llm ? await planSceneQueries(llm, drafts, { language, topic: project.topic }, signal) : drafts.map((d) => [fallbackQuery(d.text) || 'abstract background']);
  } catch (err) {
    if (signal.aborted) throw err;
    logger.warn({ err }, 'Scene query planning failed; using keyword searches');
    plannedWith = 'keywords';
    queries = drafts.map((d) => [fallbackQuery(d.text) || 'abstract background']);
  }

  const used = new Set<string>();
  const scenes: Array<{ text: string; queries: string[]; clip: StockClip | null; candidates: StockClip[] }> = [];
  for (const [i, d] of drafts.entries()) {
    await progress(20 + Math.round((i / drafts.length) * 75), 'finding_clips');
    const minDurationSec = Math.min(12, d.text.split(/\s+/).length / wps(language));
    let candidates: StockClip[] = [];
    try {
      candidates = await findClips(stock, queries[i]!, { minDurationSec, used, max: 4, signal });
    } catch (err) {
      if (signal.aborted) throw err;
      logger.warn({ err, scene: i }, 'Clip search failed for a scene');
    }
    const clip = candidates.find((c) => !used.has(c.id)) ?? null;
    if (clip) used.add(clip.id);
    scenes.push({ text: d.text, queries: queries[i]!, clip, candidates });
  }

  await Project.updateOne(
    { _id: project._id },
    { $set: { scenes, scenesKey: scenesKey(script), scenesPlannedWith: plannedWith, status: previousStatus === 'completed' ? 'completed' : 'draft', lastError: null } },
  );
  return { scenes: scenes.length, withClips: scenes.filter((s) => s.clip).length };
}

async function onDead(job: JobDoc) {
  const { projectId, previousStatus } = job.payload as PlanPayload;
  await Project.updateOne(
    { _id: projectId, lastJobId: job._id },
    { $set: { status: previousStatus === 'completed' ? 'completed' : 'draft', lastError: `Planning scenes failed: ${job.lastError ?? 'unknown error'}`.slice(0, 500) } },
  );
}

export function registerPlanScenesJob() {
  registerHandler('plan_scenes', { run, onDead });
}

