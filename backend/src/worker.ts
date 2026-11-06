// Отдельный процесс воркера: `npm run start:worker` (если RUN_WORKER_IN_PROCESS=false)
import { startWorker } from './jobs/worker.js';
import { startImporterWorker } from './workers/importer.worker.js';

startImporterWorker();
startWorker().catch((e) => {
  console.error('Не удалось запустить воркер:', e);
  process.exit(1);
});
