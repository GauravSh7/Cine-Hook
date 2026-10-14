import { logDependencyFailure } from '../../lib/dependency-diagnostics.js';

export interface HealthChecks {
  checkDatabase(): Promise<void>;
  checkRedis(): Promise<void>;
}

async function probe(dependency: 'database' | 'redis', check: () => Promise<void>): Promise<'up' | 'down'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_resolve, reject) => {
        // Longer than a 10-second connection plus the existing 2-second query cap.
        timer = setTimeout(() => reject(Object.assign(new Error('Health check timed out'), { code: 'HEALTH_TIMEOUT' })), 15000);
      }),
    ]);
    return 'up';
  } catch (error) {
    logDependencyFailure('dependency_probe_failed', dependency, error);
    return 'down';
  }
  finally { if (timer) clearTimeout(timer); }
}

export class HealthService {
  constructor(private readonly repository: HealthChecks) {}

  async readiness() {
    const [database, redis] = await Promise.all([
      probe('database', () => this.repository.checkDatabase()),
      probe('redis', () => this.repository.checkRedis()),
    ]);
    return { status: database === 'up' && redis === 'up' ? 'ready' : 'unavailable', database, redis };
  }
}
