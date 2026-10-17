import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import 'dotenv/config';
import { PasswordResetStore } from '../src/modules/auth/password-reset.store.ts';

test('real Redis OTP expiry, five attempts, resend invalidation and atomic single-use grants', async () => {
  const url = process.env.OTP_REDIS_TEST_URL || 'redis://127.0.0.1:6379';
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), 'Use an isolated local Redis target');
  const redis = createClient({ url, socket: { connectTimeout: 3000 }, disableOfflineQueue: true });
  redis.on('error', () => {});
  await redis.connect();
  const id = randomUUID(), store = new PasswordResetStore(redis);
  const keys = [];
  const key = label => { const value = `otp-test-${id}-${label}`; keys.push(`auth:recovery:otp:${value}`, `auth:recovery:token:${value}`); return value; };
  const evidence = { userId: id, credentialTag: 'a'.repeat(64), digest: 'correct-digest', attempts: 0 };
  try {
    const first = key('first'); await store.saveOtp(first, evidence, 600);
    assert.ok(await redis.ttl(`auth:recovery:otp:${first}`) <= 600);
    for (let i = 0; i < 5; i++) assert.equal(await store.verifyOtp(first, 'wrong', key(`wrong-${i}`)), false);
    assert.equal(await store.verifyOtp(first, evidence.digest, key('locked')), false);
    const old = key('old'), fresh = key('fresh');
    await store.saveOtp(old, evidence, 600); await store.saveOtp(fresh, evidence, 600);
    assert.equal(await store.verifyOtp(old, evidence.digest, key('stale')), false);
    const grants = [key('grant-a'), key('grant-b')];
    const results = await Promise.all(grants.map(grant => store.verifyOtp(fresh, evidence.digest, grant)));
    assert.equal(results.filter(Boolean).length, 1);
    const grant = grants[results.indexOf(true)];
    assert.ok(await redis.pTTL(`auth:recovery:token:${grant}`) <= 300000);
    assert.deepEqual(await store.consume(grant), { userId: id, credentialTag: evidence.credentialTag });
    assert.equal(await store.consume(grant), null);
    const expired = key('expired'); await store.saveOtp(expired, evidence, 600);
    await redis.pExpire(`auth:recovery:otp:${expired}`, 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(await store.verifyOtp(expired, evidence.digest, key('expired-grant')), false);
    const emailKey = key('limit-email'), ipKey = key('limit-ip');
    keys.push(`auth:recovery:email:${emailKey}`, `auth:recovery:ip:${ipKey}`);
    for (let i = 0; i < 5; i++) assert.equal(await store.allowRequest(emailKey, ipKey), true);
    assert.equal(await store.allowRequest(emailKey, ipKey), false);
  } finally {
    keys.push(`auth:recovery:latest:${id}`);
    await redis.del(keys); await redis.quit();
  }
});
