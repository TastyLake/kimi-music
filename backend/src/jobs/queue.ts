import { Queue, type ConnectionOptions } from 'bullmq';
import { redis } from '../lib/redis.js';

export const ENRICH_QUEUE = 'enrich';

export const connection = redis as unknown as ConnectionOptions;

export const enrichQueue = new Queue(ENRICH_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: { age: 3600 },
  },
});

/** Ставит трек в очередь обогащения. Не блокирует приложение, если Redis недоступен. */
export async function enqueueEnrich(trackId: string): Promise<void> {
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Redis timeout')), 3000));
  await Promise.race([enrichQueue.add('enrich-track', { trackId }, { jobId: `enrich-${trackId}` }), timeout]);
}
