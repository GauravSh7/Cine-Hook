import { afterEach, expect, it, vi } from 'vitest';
const capture = vi.hoisted(() => ({ adapter: vi.fn(), client: vi.fn() }));
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: class { constructor(...args: unknown[]) { capture.adapter(...args); } } }));
vi.mock('../src/generated/prisma/client.js', () => ({ PrismaClient: class { constructor(...args: unknown[]) { capture.client(...args); } } }));
import { createPrisma } from '../src/lib/prisma.js';
import { createRedis } from '../src/lib/redis.js';
afterEach(() => { vi.restoreAllMocks(); capture.adapter.mockClear(); capture.client.mockClear(); });

it('passes a longer connect deadline while preserving query and UTC safeguards', () => {
  const url = 'postgresql://user:private-password@example.invalid/database?sslmode=verify-full';
  createPrisma(url);
  const [config, callbacks] = capture.adapter.mock.calls[0]!;
  expect(config).toMatchObject({ connectionString: url, max: 10, connectionTimeoutMillis: 10000, options: '-c statement_timeout=2000 -c timezone=UTC' });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const [name, event] of [['onPoolError', 'database_pool_error'], ['onConnectionError', 'database_connection_error']]) {
    callbacks[name!](Object.assign(new Error(url), { code: 'ECONNRESET' }));
    expect(JSON.parse(log.mock.calls.at(-1)![0])).toEqual({ event, dependency: 'database', errorName: 'Error', codes: ['ECONNRESET'] });
  }
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|postgresql/);
});

it('preserves Redis TLS selection, offline queue rejection and reconnect backoff', () => {
  const redis = createRedis('rediss://default:private-password@example.invalid:6379');
  expect(redis.options?.disableOfflineQueue).toBe(true);
  expect(redis.options?.socket).toMatchObject({ connectTimeout: 10000, tls: true });
  const strategy = redis.options?.socket?.reconnectStrategy;
  expect(typeof strategy).toBe('function');
  if (typeof strategy === 'function') {
    expect(strategy(0, new Error())).toBe(250);
    expect(strategy(20, new Error())).toBe(3000);
  }
});
