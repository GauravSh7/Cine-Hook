import { createClient } from 'redis';

export function createRedis(redisUrl: string) {
  const client = createClient({
    url: redisUrl,
    disableOfflineQueue: true,
    socket: { connectTimeout: 2000, reconnectStrategy: retries => Math.min(250 * (retries + 1), 3000) },
  });
  client.on('error', () => console.error(JSON.stringify({ event: 'redis_unavailable' })));
  return client;
}
