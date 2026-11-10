import { Worker } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { connection } from './queue.js';
import { DOWNLOAD_QUEUE, enqueueTrackDownload } from './downloadQueue.js';
import { runCatalogDownload } from '../services/downloadWorker.js';

export async function resumeTrackDownloads(): Promise<void> {
  const stuck = await prisma.trackDownload.findMany({
    where: { status: { in: ['PENDING', 'PROCESSING'] } },
    select: { id: true },
  });
  for (const row of stuck) {
    await enqueueTrackDownload(row.id).catch((e) => console.error('[download] не удалось вернуть задачу:', (e as Error).message));
  }
  if (stuck.length) console.log(`[download] в очереди BullMQ: ${stuck.length}`);
}

export function startTrackDownloadWorker(): Worker {
  const worker = new Worker(
    DOWNLOAD_QUEUE,
    async (job) => {
      const downloadId = (job.data as { downloadId?: string }).downloadId;
      if (!downloadId) return;
      const row = await prisma.trackDownload.findUnique({ where: { id: downloadId } });
      if (!row || row.status === 'COMPLETED' || row.status === 'CANCELLED') return;
      await runCatalogDownload(row);
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => console.error(`[download] задача ${job?.id} не удалась:`, err.message));
  worker.on('error', (err) => console.error('[download]', err.message));
  console.log('[download] воркер BullMQ запущен');
  return worker;
}
