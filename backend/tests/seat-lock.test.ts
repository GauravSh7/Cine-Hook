import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeatLockService } from '../src/modules/seat-lock/seat-lock.service.js';
import type { SeatLockRedis } from '../src/modules/seat-lock/seat-lock.types.js';

const showId = 'c00e19a8-74c0-40e7-bd5b-834472145157';
const seatIds = ['f3903b31-f8d6-4b88-b8f0-b1ef3f1b0831', 'b2035997-d7c0-45b9-a516-160a46110438'];
const userId = '6947f804-f9ce-4a1d-96b8-883ea44d23f0';
const holdId = '5175cd69-4af6-45b8-8631-6331031c700b';
afterEach(() => vi.useRealTimers());

it('returns the server-issued five-minute expiry when Redis atomically acquires the seats', async () => {
  const service = new SeatLockService({ sendCommand: async () => [1, 1893456300000] });
  await expect(service.acquire(randomUUID(), [randomUUID(), randomUUID()], randomUUID(), randomUUID()))
    .resolves.toEqual({ expiresAt: new Date('2030-01-01T00:05:00.000Z') });
});

describe('seat lock service boundary', () => {
  it('uses one bounded Redis command with show-tagged keys and the fenced owner', async () => {
    const calls: { args: readonly string[]; options?: { timeout?: number; abortSignal?: AbortSignal } }[] = [];
    const client: SeatLockRedis = { sendCommand: async (args, options) => { calls.push({ args, options }); return [1, 1893456300000]; } };
    const result = await new SeatLockService(client).acquire(showId.toUpperCase(), seatIds, userId, holdId);
    expect(result).toEqual({ expiresAt: new Date('2030-01-01T00:05:00.000Z') });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.slice(0, 1)).toEqual(['EVAL']);
    expect(calls[0]!.args.slice(2)).toEqual(['2',
      'cinehook:seat-lock:{c00e19a8-74c0-40e7-bd5b-834472145157}:f3903b31-f8d6-4b88-b8f0-b1ef3f1b0831',
      'cinehook:seat-lock:{c00e19a8-74c0-40e7-bd5b-834472145157}:b2035997-d7c0-45b9-a516-160a46110438',
      `${userId}:${holdId}`, '300000']);
    expect(calls[0]!.options!.timeout).toBe(2000);
    expect(calls[0]!.options!.abortSignal).toBeInstanceOf(AbortSignal);
  });
  it('returns a safe409 when Redis reports any locked seat', async () => {
    const service = new SeatLockService({ sendCommand: async () => [0] });
    await expect(service.acquire(showId, seatIds, userId, holdId)).rejects.toMatchObject({ status: 409, code: 'SEAT_LOCKED' });
  });
  it('decodes owner-checked release and read-only validation', async () => {
    const service = new SeatLockService({ sendCommand: async () => 2 });
    await expect(service.release(showId, seatIds, userId, holdId)).resolves.toBe(2);
    const valid = new SeatLockService({ sendCommand: async () => 1 });
    const invalid = new SeatLockService({ sendCommand: async () => 0 });
    await expect(valid.validate(showId, seatIds, userId, holdId)).resolves.toBe(true);
    await expect(invalid.validate(showId, seatIds, userId, holdId)).resolves.toBe(false);
  });
  it('exposes only lock state and remaining milliseconds from Redis', async () => {
    const service = new SeatLockService({ sendCommand: async () => [[1, 290000], [0, 0]] });
    expect(await service.inspect(showId, seatIds)).toEqual(new Map([
      [seatIds[0], { locked: true, remainingMs: 290000 }], [seatIds[1], { locked: false, remainingMs: 0 }],
    ]));
  });
  it.each(['acquire', 'release', 'validate', 'inspect'] as const)('fails closed with safe503 on Redis error: %s', async method => {
    const service = new SeatLockService({ sendCommand: async () => { throw new Error(`connection failed ${userId}:${holdId}`); } });
    try { await service[method](showId, seatIds, userId, holdId); throw new Error('Expected unavailable'); }
    catch (error) { expect(error).toMatchObject({ status: 503, code: 'SEAT_LOCK_UNAVAILABLE' }); expect(String(error)).not.toContain(userId); }
  });
  it.each(['acquire', 'release', 'validate', 'inspect'] as const)('bounds a stalled Redis command at two seconds: %s', async method => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const service = new SeatLockService({ sendCommand: async (_args, options) => { signal = options?.abortSignal; return new Promise(() => {}); } });
    const result = expect(service[method](showId, seatIds, userId, holdId)).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(2000);
    await result;
    expect(signal?.aborted).toBe(true);
  });
  it.each([null, [], [1, 'not-an-expiry'], [1, -1], [0, 42]])('fails closed on malformed acquisition replies: %j', async reply => {
    const service = new SeatLockService({ sendCommand: async () => reply });
    await expect(service.acquire(showId, seatIds, userId, holdId)).rejects.toMatchObject({ status: 503 });
  });
  it('rejects unsafe key components and duplicate seat IDs before touching Redis', async () => {
    const client = { sendCommand: async () => { throw new Error('Unexpected Redis I/O'); } };
    const service = new SeatLockService(client);
    for (const [show, seats] of [['bad{slot}', seatIds], [showId, [seatIds[0]!, seatIds[0]!.toUpperCase()]], [showId, []]] as const) {
      await expect(service.acquire(show, [...seats], userId, holdId)).rejects.toMatchObject({ status: 400 });
    }
  });
  it('rejects empty hold operations and safely inspects an empty seat set', async () => {
    const service = new SeatLockService({ sendCommand: async () => { throw new Error('Unexpected Redis I/O'); } });
    await expect(service.release(showId, [], userId, holdId)).rejects.toMatchObject({ status: 400 });
    await expect(service.validate(showId, [], userId, holdId)).rejects.toMatchObject({ status: 400 });
    await expect(service.inspect(showId, [])).resolves.toEqual(new Map());
  });
});
