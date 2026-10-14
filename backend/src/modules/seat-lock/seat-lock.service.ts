import { AppError } from '../../errors/app-error.js';
import type { SeatLockRedis, SeatLocks } from './seat-lock.types.js';
import { acquireScript, releaseScript, validateScript, inspectScript } from './seat-lock.scripts.js';

const ttlMs = 300000;
const timeoutMs = 2000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = () => new AppError(503, 'SEAT_LOCK_UNAVAILABLE', 'Seat locking is temporarily unavailable.');
const invalid = () => new AppError(400, 'VALIDATION_ERROR', 'Invalid seat lock input.');
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

export class SeatLockService implements SeatLocks {
  constructor(private readonly client: SeatLockRedis, private readonly namespace: 'movie' | 'event' = 'movie') {}

  private keys(showId: string, seatIds: string[]): string[] {
    if (!uuid.test(showId) || seatIds.length > (this.namespace === 'event' ? 100000 : 1000) || seatIds.some(id => !uuid.test(id))) throw invalid();
    const ids = seatIds.map(id => id.toLowerCase());
    if (new Set(ids).size !== ids.length) throw invalid();
    const prefix = this.namespace === 'event' ? 'event-seat-lock' : 'seat-lock';
    return ids.map(id => `cinehook:${prefix}:{${showId.toLowerCase()}}:${id}`);
  }

  private owner(userId: string, holdId: string): string {
    if (!uuid.test(userId) || !uuid.test(holdId)) throw invalid();
    return `${userId.toLowerCase()}:${holdId.toLowerCase()}`;
  }

  private async run(script: string, keys: string[], args: string[] = []): Promise<unknown> {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Native timeout/abort removes a queued command. The outer deadline also
      // bounds a broken or stalled adapter; an already-sent write may still run,
      // so callers must treat 503 as unknown outcome and never retry implicitly.
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(unavailable()); }, timeoutMs);
      });
      const reply = this.client.sendCommand(['EVAL', script, String(keys.length), ...keys, ...args], {
        timeout: timeoutMs, abortSignal: abort.signal,
      });
      return await Promise.race([reply, deadline]);
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  async acquire(showId: string, seatIds: string[], userId: string, holdId: string): Promise<{ expiresAt: Date }> {
    const keys = this.keys(showId, seatIds);
    const owner = this.owner(userId, holdId);
    if (!keys.length) throw invalid();
    const reply = await this.run(acquireScript, keys, [owner, String(ttlMs)]);
    if (Array.isArray(reply) && reply.length === 1 && reply[0] === 0) {
      throw new AppError(409, 'SEAT_LOCKED', 'One or more selected seats are already held.');
    }
    if (!Array.isArray(reply) || reply.length !== 2 || reply[0] !== 1 || !integer(reply[1])
      || reply[1] <= 0 || !Number.isFinite(new Date(reply[1]).getTime())) throw unavailable();
    return { expiresAt: new Date(reply[1]) };
  }

  async release(showId: string, seatIds: string[], userId: string, holdId: string): Promise<number> {
    const keys = this.keys(showId, seatIds); const owner = this.owner(userId, holdId);
    if (!keys.length) throw invalid();
    const reply = await this.run(releaseScript, keys, [owner]);
    if (!integer(reply) || reply < 0 || reply > keys.length) throw unavailable();
    return reply;
  }

  async validate(showId: string, seatIds: string[], userId: string, holdId: string): Promise<boolean> {
    const keys = this.keys(showId, seatIds); const owner = this.owner(userId, holdId);
    if (!keys.length) throw invalid();
    const reply = await this.run(validateScript, keys, [owner]);
    if (reply !== 0 && reply !== 1) throw unavailable();
    return reply === 1;
  }

  async inspect(showId: string, seatIds: string[]): Promise<Map<string, { locked: boolean; remainingMs: number }>> {
    const keys = this.keys(showId, seatIds);
    if (!keys.length) return new Map();
    const reply = await this.run(inspectScript, keys);
    if (!Array.isArray(reply) || reply.length !== keys.length) throw unavailable();
    const result = new Map<string, { locked: boolean; remainingMs: number }>();
    for (let index = 0; index < seatIds.length; index++) {
      const state: unknown = reply[index];
      if (!Array.isArray(state) || state.length !== 2 || (state[0] !== 0 && state[0] !== 1)
        || !integer(state[1]) || state[1] < 0 || state[1] > ttlMs || (state[0] === 0 && state[1] !== 0)) throw unavailable();
      result.set(seatIds[index]!, { locked: state[0] === 1, remainingMs: state[1] });
    }
    return result;
  }
}
