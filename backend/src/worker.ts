// Отдельный процесс воркера: `npm run start:worker` (если RUN_WORKER_IN_PROCESS=false)
import { startWorker } from './jobs/worker.js';
import { resumeTrackDownloads, startTrackDownloadWorker } from './jobs/trackDownloadWorker.js';
import { startImporterWorker } from './workers/importer.worker.js';

startImporterWorker();
startTrackDownloadWorker();
resumeTrackDownloads().catch((e) => console.error('[download] не удалось восстановить очередь:', e));
startWorker().catch((e) => {
  console.error('Не удалось запустить воркер:', e);
  process.exit(1);
});
