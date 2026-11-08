export type JobType =
  | 'video_render'
  | 'video_analyze'
  | 'avatar_generate'
  | 'faceless_generate'
  | 'transcription';

export interface VideoRenderJobData {
  projectId: string;
  userId: string;
  workspaceId: string;
  priority?: 'low' | 'normal' | 'high';
}

export interface VideoAnalyzeJobData {
  projectId: string;
  userId: string;
}

export interface AvatarGenerateJobData {
  projectId: string;
  userId: string;
  workspaceId: string;
  avatarId: string;
  script: string;
  language: string;
  voiceId: string;
}

export interface FacelessGenerateJobData {
  projectId: string;
  userId: string;
  workspaceId: string;
  script: string;
  templateId?: string;
  voiceId: string;
  aspectRatio: string;
}

export interface TranscriptionJobData {
  projectId: string;
  userId: string;
  mediaUrl: string;
}

export type JobDataMap = {
  video_render: VideoRenderJobData;
  video_analyze: VideoAnalyzeJobData;
  avatar_generate: AvatarGenerateJobData;
  faceless_generate: FacelessGenerateJobData;
  transcription: TranscriptionJobData;
};

export type JobData = JobDataMap[JobType];

export interface JobProgress {
  stage: string;
  progress: number;
  message?: string;
}

export interface SimpleJob<T = any> {
  id: string;
  name: JobType;
  data: T;
  progress: number | JobProgress;
  state: 'waiting' | 'active' | 'completed' | 'failed';
  failedReason?: string;
  returnvalue?: any;
}

// Simple in-memory job store (executes synchronously)
const jobs = new Map<string, SimpleJob>();

function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export async function addJob<T extends JobType>(
  type: T,
  data: JobDataMap[T]
): Promise<SimpleJob<JobDataMap[T]>> {
  const jobId = generateJobId();
  const job: SimpleJob<JobDataMap[T]> = {
    id: jobId,
    name: type,
    data,
    progress: 0,
    state: 'waiting',
  };
  jobs.set(jobId, job);
  
  // Execute synchronously in background (non-blocking)
  setImmediate(async () => {
    job.state = 'active';
    job.progress = { stage: 'starting', progress: 5, message: 'Starting job...' };
    
    try {
      // The actual processing is done by the service methods directly
      // This job just tracks status
      job.state = 'completed';
      job.progress = { stage: 'completed', progress: 100, message: 'Job completed' };
    } catch (err: any) {
      job.state = 'failed';
      job.failedReason = err.message;
      job.progress = { stage: 'failed', progress: 0, message: err.message };
    }
  });
  
  return job;
}

export async function getJobStatus(jobId: string): Promise<SimpleJob | undefined> {
  return jobs.get(jobId);
}

export async function getQueueStats() {
  const jobList = Array.from(jobs.values());
  return {
    waiting: jobList.filter(j => j.state === 'waiting').length,
    active: jobList.filter(j => j.state === 'active').length,
    completed: jobList.filter(j => j.state === 'completed').length,
    failed: jobList.filter(j => j.state === 'failed').length,
    delayed: 0,
  };
}

// No-op for compatibility
export function createWorker<T extends JobType>(
  type: T,
  processor: (job: SimpleJob<JobDataMap[T]>) => Promise<any>,
  concurrency = 2
): { close: () => Promise<void> } {
  return {
    close: async () => {},
  };
}

export async function closeQueue(): Promise<void> {
  jobs.clear();
}