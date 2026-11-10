import { Worker } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { enrichTrack } from '../services/enrich.js';
import { connection, ENRICH_QUEUE, enqueueEnrich, enrichQueue } from './queue.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Находит треки без жанра или обложки (и давно не обрабатывавшиеся) и ставит их в очередь. */
export async function sweep(): Promise<{ queued: number }> {
  const retryAfter = new Date(Date.now() - 7 * DAY_MS);
  const tracks = await prisma.track.findMany({
    where: {
      status: 'PARSED',
      AND: [
        { OR: [{ genres: { none: {} } }, { coverImageUrl: null }] },
        { OR: [{ enrichedAt: null }, { enrichedAt: { lt: retryAfter } }] },
      ],
    },
    select: { id: true },
    take: 1000,
  });
  for (const t of tracks) await enqueueEnrich(t.id);
  return { queued: tracks.length };
}

export async function startWorker(): Promise<Worker> {
  const worker = new Worker(
    ENRICH_QUEUE,
    async (job) => {
      if (job.name === 'enrich-sweep') return sweep();
      return enrichTrack((job.data as { trackId: string }).trackId);
    },
    { connection, concurrency: 2 },
  );
  worker.on('failed', (job, err) => console.error(`[worker] задача ${job?.id} не удалась:`, err.message));
  worker.on('error', (err) => console.error('[worker]', err.message));

  // Раз в 24 часа + один проход сразу после старта
  await enrichQueue.upsertJobScheduler('enrich-sweep-daily', { every: DAY_MS }, { name: 'enrich-sweep' });
  await enrichQueue.add('enrich-sweep', {}, { jobId: `sweep-boot-${Date.now()}` });
  console.log('[worker] воркер обогащения запущен');
  return worker;
}
