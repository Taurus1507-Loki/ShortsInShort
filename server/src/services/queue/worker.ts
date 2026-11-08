import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import type { JobDoc, JobType } from '../../models/Job.js';
import { claim, complete, fail, heartbeat, sweepExpired } from './queue.js';
import { sweepAbandonedUploads } from '../asset.service.js';

export interface JobContext {
  job: JobDoc;
  signal: AbortSignal;
  /** Records progress (0–100) and stage; also renews the lease. */
  progress: (pct: number, stage?: string) => Promise<void>;
}

export interface JobHandler {
  run(ctx: JobContext): Promise<unknown>;
  /** Called once when a job reaches the dead-letter state (compensation, e.g. refunds). */
  onDead?(job: JobDoc): Promise<void>;
}

const handlers = new Map<JobType, JobHandler>();
export const registerHandler = (type: JobType, h: JobHandler) => handlers.set(type, h);

export class Worker {
  readonly id = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private running = 0;
  private stopped = true;
  private timer: NodeJS.Timeout | null = null;
  private lastSweep = 0;
  private lastUploadSweep = 0;
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly concurrency = env.video.workerConcurrency,
    private readonly pollMs = 1000,
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    logger.info({ worker: this.id, concurrency: this.concurrency, types: [...handlers.keys()] }, 'Worker started');
    this.schedule(0);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    // Abort running jobs; their leases expire and another worker retries them.
    for (const c of this.active.values()) c.abort();
    while (this.running > 0) await new Promise((r) => setTimeout(r, 100));
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick() {
    try {
      await this.maintenance();
      while (!this.stopped && this.running < this.concurrency) {
        const claimed = await this.runOnce(false);
        if (!claimed) break;
      }
    } catch (err) {
      logger.error({ err }, 'Worker tick failed');
    }
    this.schedule(this.pollMs);
  }

  private async maintenance() {
    const now = Date.now();
    if (now - this.lastSweep > 30_000) {
      this.lastSweep = now;
      for (const job of await sweepExpired()) await this.dead(job);
    }
    if (now - this.lastUploadSweep > 60 * 60_000) {
      this.lastUploadSweep = now;
      await sweepAbandonedUploads().catch((err) => logger.warn({ err }, 'Upload sweep failed'));
    }
  }

  /**
   * Claims and processes one job. With `wait=true` (tests/CLI) resolves after the job finishes;
   * otherwise processing continues in the background. Returns whether a job was claimed.
   */
  async runOnce(wait = true): Promise<boolean> {
    const job = await claim(this.id, [...handlers.keys()]);
    if (!job) return false;
    this.running++;
    const p = this.process(job).finally(() => this.running--);
    if (wait) await p;
    return true;
  }

  private async process(job: JobDoc) {
    const handler = handlers.get(job.type as JobType)!;
    const controller = new AbortController();
    const key = job._id.toString();
    this.active.set(key, controller);
    const log = logger.child({ jobId: key, type: job.type, attempt: job.attempts });
    const timeout = setTimeout(() => controller.abort(new Error('Job timed out')), env.video.jobTimeoutMs);
    // Keep the lease alive even while a long FFmpeg step reports no progress.
    const beat = setInterval(() => {
      void heartbeat(job._id, this.id).then((ok) => !ok && controller.abort(new Error('Lease lost')));
    }, 20_000);

    try {
      log.info('Job started');
      const result = await handler.run({
        job,
        signal: controller.signal,
        progress: async (pct, stage) => {
          const ok = await heartbeat(job._id, this.id, { progress: pct, stage });
          if (!ok) controller.abort(new Error('Lease lost'));
        },
      });
      await complete(job._id, this.id, result ?? null);
      log.info('Job completed');
    } catch (err) {
      const outcome = await fail(job, this.id, err);
      log.warn({ err, outcome }, 'Job failed');
      if (outcome === 'dead') await this.dead(job, err);
    } finally {
      clearTimeout(timeout);
      clearInterval(beat);
      this.active.delete(key);
    }
  }

  private async dead(job: JobDoc, err?: unknown) {
    const handler = handlers.get(job.type as JobType);
    try {
      if (err instanceof Error) job.lastError = err.message;
      await handler?.onDead?.(job);
    } catch (e) {
      logger.error({ err: e, jobId: job._id.toString() }, 'onDead compensation failed');
    }
  }
}
