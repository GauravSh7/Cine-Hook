import { createClient } from 'redis';
import { logDependencyFailure } from './dependency-diagnostics.js';

export function createRedis(redisUrl: string) {
  const client = createClient({
    url: redisUrl,
    disableOfflineQueue: true,
    socket: { connectTimeout: 10000, reconnectStrategy: retries => Math.min(250 * (retries + 1), 3000) },
  });
  client.on('error', error => logDependencyFailure('redis_unavailable', 'redis', error));
  return client;
}
