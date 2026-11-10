import { Redis } from 'ioredis';
import { config } from '../config.js';

// maxRetriesPerRequest: null — обязательное требование BullMQ
export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
redis.on('error', (e: Error) => console.error('[redis]', e.message));
