import { Queue, type ConnectionOptions } from 'bullmq';
import { redis } from '../lib/redis.js';

export const DOWNLOAD_QUEUE = 'track-download';

const connection = redis as unknown as ConnectionOptions;

export const trackDownloadQueue = new Queue(DOWNLOAD_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: true,
    removeOnFail: { age: 3600 },
  },
});

export async function enqueueTrackDownload(downloadId: string): Promise<void> {
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Redis timeout')), 3000));
  await Promise.race([
    trackDownloadQueue.add('download-track', { downloadId }, { jobId: `dl-${downloadId}` }),
    timeout,
  ]).catch((err: Error) => {
    if (/already exists|Job is already/i.test(err.message)) return;
    throw err;
  });
}
