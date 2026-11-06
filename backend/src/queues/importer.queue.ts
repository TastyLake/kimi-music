import { Queue } from 'bullmq';
import { connection } from '../jobs/queue.js';

export interface SpotifyImportJobData {
  url: string;
  userId: string;
  targetDir?: string;
}

export const SPOTIFY_IMPORT_QUEUE = 'spotify-importer';

export const spotifyImportQueue = new Queue<SpotifyImportJobData>(SPOTIFY_IMPORT_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { age: 24 * 3600 },
    removeOnFail: { age: 3600 },
  },
});
