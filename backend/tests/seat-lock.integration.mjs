import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createClient } from 'redis';
import { SeatLockService } from '../dist/modules/seat-lock/seat-lock.service.js';

const url = process.env.SEAT_LOCK_TEST_REDIS_URL;
test('Redis seat locks: actual Lua concurrency, TTL, ownership, ABA and rollback', { skip: !url, timeout: 30000 }, async t => {
  // DB15 is explicitly reserved for this integration run. Random show/seat IDs
  // isolate every key further; cleanup never scans or flushes shared Redis data.
  assert.equal(new URL(url).pathname, '/15', 'Seat-lock tests require the isolated Redis test database /15.');
  const options = { url, disableOfflineQueue: true, socket: { reconnectStrategy: false, connectTimeout: 2000 } };
  const first = createClient(options), second = createClient(options);
  first.on('error', () => {}); second.on('error', () => {});
  const a = new SeatLockService(first), b = new SeatLockService(second);
  const ownedKeys = new Set();
  const ids = (count = 3) => {
    const showId = randomUUID(), seatIds = Array.from({ length: count }, () => randomUUID());
    for (const seatId of seatIds) ownedKeys.add(`cinehook:seat-lock:{${showId}}:${seatId}`);
    return { showId, seatIds, userId: randomUUID(), holdId: randomUUID() };
  };
  const key = (showId, seatId) => `cinehook:seat-lock:{${showId}}:${seatId}`;
  try {
    await Promise.all([first.connect(), second.connect()]);
    await t.test('competing multi-seat acquisition is all-or-nothing', async () => {
      for (let iteration = 0; iteration < 8; iteration++) {
        const f = ids(), otherUser = randomUUID(), otherHold = randomUUID();
        const race = await Promise.allSettled([
          a.acquire(f.showId, f.seatIds.slice(0, 2), f.userId, f.holdId),
          b.acquire(f.showId, f.seatIds.slice(1, 3), otherUser, otherHold),
        ]);
        assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
        const rejected = race.find(result => result.status === 'rejected');
        assert.equal(rejected.reason.status, 409);
        assert.equal(rejected.reason.code, 'SEAT_LOCKED');
        const leftWon = race[0].status === 'fulfilled';
        assert.equal(await first.get(key(f.showId, f.seatIds[1])), leftWon ? `${f.userId}:${f.holdId}` : `${otherUser}:${otherHold}`);
        assert.equal(await first.exists(key(f.showId, f.seatIds[leftWon ? 2 : 0])), 0, 'Losing request must not retain its uncontested seat.');
        assert.equal(await first.exists(f.seatIds.map(seatId => key(f.showId, seatId))), 2);
      }
    });
    await t.test('same seat UUID on distinct shows has independent locks', async () => {
      const f = ids(1), otherShow = randomUUID(); ownedKeys.add(key(otherShow, f.seatIds[0]));
      await a.acquire(f.showId, f.seatIds, f.userId, f.holdId);
      await b.acquire(otherShow, f.seatIds, randomUUID(), randomUUID());
      assert.equal(await first.exists(key(f.showId, f.seatIds[0])), 1);
      assert.equal(await first.exists(key(otherShow, f.seatIds[0])), 1);
    });
    await t.test('expiry comes from Redis TIME and is exactly five minutes without renewal', async () => {
      const f = ids(2);
      const result = await a.acquire(f.showId, f.seatIds, f.userId, f.holdId);
      const keys = f.seatIds.map(seatId => key(f.showId, seatId));
      for (const seatKey of keys) {
        assert.equal(await first.sendCommand(['PEXPIRETIME', seatKey]), result.expiresAt.getTime());
        const ttl = await first.pTTL(seatKey); assert.ok(ttl > 299000 && ttl <= 300000);
        await first.pExpire(seatKey, 100000);
      }
      assert.equal(await a.validate(f.showId, f.seatIds, f.userId, f.holdId), true);
      assert.equal(await b.validate(f.showId, f.seatIds, randomUUID(), randomUUID()), false);
      await assert.rejects(a.acquire(f.showId, f.seatIds, f.userId, f.holdId), { status: 409 });
      const inspection = await a.inspect(f.showId, f.seatIds);
      for (const state of inspection.values()) {
        assert.deepEqual(Object.keys(state).sort(), ['locked', 'remainingMs']);
        assert.equal(state.locked, true); assert.ok(state.remainingMs > 99000 && state.remainingMs <= 100000);
      }
      for (const seatKey of keys) assert.ok(await first.pTTL(seatKey) <= 100000, 'Neither inspect, validate nor repeated acquire may renew a hold.');
    });
    await t.test('release deletes only matching user and hold; an old hold cannot clear a new same-user hold', async () => {
      const f = ids(2), newHold = randomUUID();
      await a.acquire(f.showId, f.seatIds, f.userId, f.holdId);
      assert.equal(await b.release(f.showId, f.seatIds, randomUUID(), f.holdId), 0);
      assert.equal(await b.release(f.showId, f.seatIds, f.userId, newHold), 0);
      for (const seatId of f.seatIds) await first.pExpire(key(f.showId, seatId), 0);
      assert.equal(await a.validate(f.showId, f.seatIds, f.userId, f.holdId), false);
      await b.acquire(f.showId, f.seatIds, f.userId, newHold);
      assert.equal(await a.release(f.showId, f.seatIds, f.userId, f.holdId), 0);
      assert.equal(await b.validate(f.showId, f.seatIds, f.userId, newHold), true);
      assert.equal(await b.release(f.showId, f.seatIds, f.userId, newHold), 2);
      assert.equal(await b.release(f.showId, f.seatIds, f.userId, newHold), 0);
      assert.deepEqual([...await a.inspect(f.showId, f.seatIds)].map(([, state]) => state), [{ locked: false, remainingMs: 0 }, { locked: false, remainingMs: 0 }]);
    });
    await t.test('foreign keys survive a mixed owner-checked release', async () => {
      const f = ids(3), foreignUser = randomUUID(), foreignHold = randomUUID();
      await a.acquire(f.showId, [f.seatIds[0]], f.userId, f.holdId);
      await b.acquire(f.showId, [f.seatIds[1]], foreignUser, foreignHold);
      assert.equal(await a.release(f.showId, f.seatIds, f.userId, f.holdId), 1);
      assert.equal(await b.validate(f.showId, [f.seatIds[1]], foreignUser, foreignHold), true);
    });
    await t.test('Redis script error on its second write rolls back the first actual write', async () => {
      const f = ids(2);
      const fault = new SeatLockService({ sendCommand: (args, commandOptions) => {
        const command = [...args];
        // Fault injection changes only the second SET's command name. Redis
        // itself raises the runtime error; the real Lua cleanup executes there.
        command[1] = command[1].replace("redis.pcall('SET', key", "redis.pcall(#written == 1 and 'CINEHOOK_INJECTED_UNKNOWN_COMMAND' or 'SET', key");
        return first.sendCommand(command, commandOptions);
      } });
      await assert.rejects(fault.acquire(f.showId, f.seatIds, f.userId, f.holdId), { status: 503, code: 'SEAT_LOCK_UNAVAILABLE' });
      for (const seatId of f.seatIds) assert.equal(await first.exists(key(f.showId, seatId)), 0);
      await a.acquire(f.showId, f.seatIds, f.userId, f.holdId);
    });
    await t.test('a disconnected real client fails closed without an in-memory hold', async () => {
      const f = ids(1); second.destroy();
      await assert.rejects(b.acquire(f.showId, f.seatIds, f.userId, f.holdId), { status: 503 });
      assert.equal(await first.exists(key(f.showId, f.seatIds[0])), 0);
    });
  } finally {
    try { if (first.isReady && ownedKeys.size) await first.del([...ownedKeys]); }
    finally {
      if (first.isOpen) first.destroy();
      if (second.isOpen) second.destroy();
    }
  }
});
