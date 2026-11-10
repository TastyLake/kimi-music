import { enqueueEnrich } from '../jobs/queue.js';

export function onTrackReady(trackId: string): void {
  enqueueEnrich(trackId).catch((e: Error) => 
    console.error('[trackEvents] ошибка добавления в очередь обогащения:', e.message)
  );
}