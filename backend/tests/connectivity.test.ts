import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthService } from '../src/modules/health/health.service.js';
import { createRedis } from '../src/lib/redis.js';
import { dependencyErrorDetails } from '../src/lib/dependency-diagnostics.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('hosted dependency readiness', () => {
  it('handles cyclic aggregate errors without leaking unknown codes', () => {
    const root = new AggregateError([Object.assign(new Error('secret'), { code: 'ENOTFOUND' })], 'secret');
    Object.assign(root, { cause: root, code: 'private-password' });
    expect(dependencyErrorDetails(root)).toEqual({ errorName: 'AggregateError', codes: ['ENOTFOUND'] });
  });
  it('allows a connection taking four seconds to become ready', async () => {
    vi.useFakeTimers();
    const service = new HealthService({
      checkDatabase: () => new Promise(resolve => setTimeout(resolve, 4000)),
      checkRedis: async () => {},
    });
    const pending = service.readiness();
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toEqual({ status: 'ready', database: 'up', redis: 'up' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs nested database error codes without private driver metadata', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('postgresql://private:password@host/database'), {
      name: 'PrismaClientKnownRequestError', code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '28P01', originalMessage: 'private password' } } },
    });
    const service = new HealthService({ checkDatabase: async () => { throw error; }, checkRedis: async () => {} });
    expect(await service.readiness()).toEqual({ status: 'unavailable', database: 'down', redis: 'up' });
    expect(log.mock.calls.map(([line]) => JSON.parse(line))).toContainEqual({
      event: 'dependency_probe_failed', dependency: 'database', errorName: 'PrismaClientKnownRequestError', codes: ['P2010', '28P01'],
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|password|postgresql/);
  });

  it('bounds a hung probe and logs a safe timeout code', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = new HealthService({ checkDatabase: () => new Promise(() => {}), checkRedis: async () => {} }).readiness();
    await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toEqual({ status: 'unavailable', database: 'down', redis: 'up' });
    expect(log.mock.calls.map(([line]) => JSON.parse(line))).toContainEqual({
      event: 'dependency_probe_failed', dependency: 'database', errorName: 'Error', codes: ['HEALTH_TIMEOUT'],
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not log attacker-controlled names, codes or stacks', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const privateError = { name: 'private-password', code: 'SECRET_VALUE', message: 'secret-url', stack: 'secret-stack' };
    await new HealthService({ checkDatabase: async () => { throw privateError; }, checkRedis: async () => {} }).readiness();
    expect(log.mock.calls.map(([line]) => JSON.parse(line))).toContainEqual({
      event: 'dependency_probe_failed', dependency: 'database', errorName: 'UnknownError', codes: [],
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|SECRET|secret/);
  });

  it('logs Redis authentication failures without their message or URL', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const redis = createRedis('rediss://default:private-password@example.invalid:6379');
    redis.emit('error', new Error('WRONGPASS invalid username-password pair rediss://private'));
    expect(log.mock.calls.map(([line]) => JSON.parse(line))).toContainEqual({
      event: 'redis_unavailable', dependency: 'redis', errorName: 'Error', codes: ['WRONGPASS'],
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|password|rediss/);
  });
});
