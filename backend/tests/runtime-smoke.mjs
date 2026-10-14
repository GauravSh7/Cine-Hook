import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

test('compiled server serves live health and reports real unavailable connections', async () => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['dist/server.js'], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://example:example@127.0.0.1:1/cinehook',
      REDIS_URL: 'redis://127.0.0.1:1', FRONTEND_ORIGIN: 'http://localhost:5173',
      JWT_SECRET: 'test-only-signing-secret-1234567890123456789' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let startup = '';
  child.stdout.on('data', data => { startup += data.toString(); });
  child.stderr.resume();
  try {
    for (let attempt = 0; attempt < 50 && !startup.includes('server_started') && child.exitCode === null; attempt++) {
      await delay(100);
    }
    assert.ok(startup.includes('server_started'), 'compiled API must start');
    const live = await fetch(`http://127.0.0.1:${port}/api/health/live`, { signal: AbortSignal.timeout(4000) });
    assert.equal(live.status, 200);
    assert.equal((await live.json()).data.status, 'alive');
    const ready = await fetch(`http://127.0.0.1:${port}/api/health/ready`, { signal: AbortSignal.timeout(4000) });
    assert.equal(ready.status, 503);
    assert.deepEqual((await ready.json()).data, { status: 'unavailable', database: 'down', redis: 'down' });
    const protectedMe = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { signal: AbortSignal.timeout(4000) });
    assert.equal(protectedMe.status, 401);
    assert.equal((await protectedMe.json()).error.code, 'UNAUTHORIZED');
    const protectedMovie = await fetch(`http://127.0.0.1:${port}/api/admin/movies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(4000) });
    assert.equal(protectedMovie.status, 401);
  } finally {
    if (child.exitCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
  }
});

test('compiled server exits on bad configuration without echoing credentials', () => {
  const result = spawnSync(process.execPath, ['dist/server.js'], {
    env: { ...process.env, DATABASE_URL: 'https://secret-credential.invalid', REDIS_URL: 'redis://127.0.0.1:1',
      FRONTEND_ORIGIN: 'http://localhost:5173', JWT_SECRET: 'test-only-signing-secret-1234567890123456789' },
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid configuration: DATABASE_URL/);
  assert.ok(!result.stderr.includes('secret-credential'));
});
