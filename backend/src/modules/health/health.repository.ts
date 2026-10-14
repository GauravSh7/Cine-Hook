import type { PrismaClient } from '../../generated/prisma/client.js';
import type { createRedis } from '../../lib/redis.js';
import type { HealthChecks } from './health.service.js';

export class HealthRepository implements HealthChecks {
  constructor(private readonly prisma: PrismaClient, private readonly redis: ReturnType<typeof createRedis>) {}

  async checkDatabase(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  async checkRedis(): Promise<void> {
    if (!this.redis.isReady) throw new Error('Redis unavailable');
    if (await this.redis.ping() !== 'PONG') throw new Error('Redis unavailable');
  }
}
