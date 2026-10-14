export interface HealthChecks {
  checkDatabase(): Promise<void>;
  checkRedis(): Promise<void>;
}

async function probe(check: () => Promise<void>): Promise<'up' | 'down'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Health check timed out')), 2500);
      }),
    ]);
    return 'up';
  } catch { return 'down'; }
  finally { if (timer) clearTimeout(timer); }
}

export class HealthService {
  constructor(private readonly repository: HealthChecks) {}

  async readiness() {
    const [database, redis] = await Promise.all([
      probe(() => this.repository.checkDatabase()),
      probe(() => this.repository.checkRedis()),
    ]);
    return { status: database === 'up' && redis === 'up' ? 'ready' : 'unavailable', database, redis };
  }
}
