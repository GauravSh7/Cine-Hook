import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

test('compiled standalone bridge needs no database/provider config and never opens business routes', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ['dist/maintenance-bridge.js'], {
    env: { ...process.env, PORT: '0', MAINTENANCE_MODE: 'false', DATABASE_URL: 'invalid', REDIS_URL: 'invalid', JWT_SECRET: '', RAZORPAY_KEY_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exit = once(child, 'exit');
  const lines = createInterface({ input: child.stdout });
  try {
    const started = await Promise.race([
      once(lines, 'line').then(([line]) => JSON.parse(line)),
      exit.then(() => { throw new Error('Bridge exited before readiness'); }),
    ]);
    assert.equal(started.event, 'maintenance_bridge_started');
    const base = `http://127.0.0.1:${started.port}`;
    for (const path of ['/api/health/live', '/api/health/ready']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.dependencies, 'not_checked');
    }
    for (const path of ['/api/auth/login', '/api/auth/ownership/complete', '/api/bookings', '/api/payments/verify', '/api/webhooks/razorpay', '/api/health/live']) {
      const response = await fetch(base + path, { method: 'POST', body: '{malformed',
        headers: { Authorization: 'Bearer old-session', 'Content-Type': 'application/json', 'x-razorpay-signature': 'claimed', 'x-maintenance-bypass': 'true' } });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('retry-after'), '60');
      assert.equal(response.headers.get('x-cinehook-maintenance'), 'bridge-v1');
      assert.equal((await response.json()).error.code, 'MAINTENANCE');
    }
  } finally {
    lines.close(); child.kill(); await exit;
  }
});
