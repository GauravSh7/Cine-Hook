import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from 'redis';
import { randomUUID, createHmac } from 'node:crypto';
import { OwnershipProofStore } from '../src/modules/auth/ownership-proof.store.ts';

const url = process.env.OWNERSHIP_PROOF_TEST_REDIS_URL;
test('ownership proofs bind purpose, expire, limit attempts and cannot be replayed', { skip: !url }, async () => {
  const target = new URL(url); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55449'); assert.equal(target.pathname, '/15');
  const redis = createClient({ url }); await redis.connect();
  const secret = 'isolated-test-secret-never-used-for-app-123456789';
  const store = new OwnershipProofStore(redis, secret);
  const email = `${randomUUID()}@example.test`;
  try {
    let otp;
    const request = () => store.request({ purpose: 'REGISTER', email, address: randomUUID(), snapshot: null, send: async value => { otp = value; } });
    const challenge = await request();
    const verified = await store.verify(challenge.challengeId, otp);
    assert.equal(await store.consume(verified.token, 'CLEAN_START'), null);
    // A wrong-purpose consumption fails closed and burns the stolen grant.
    assert.equal(await store.consume(verified.token, 'REGISTER'), null);
    const next = await request();
    const grant = await store.verify(next.challengeId, otp);
    const winners = await Promise.all([store.consume(grant.token, 'REGISTER'), store.consume(grant.token, 'REGISTER')]);
    assert.equal(winners.filter(Boolean).length, 1);
    assert.equal(winners.find(Boolean).email, email);
    await assert.rejects(store.verify(next.challengeId, otp));
    const wrong = await request(), right = otp;
    const incorrect = right === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) await assert.rejects(store.verify(wrong.challengeId, incorrect));
    await assert.rejects(store.verify(wrong.challengeId, right));
    const expired = await request();
    const keys = await redis.keys('auth:ownership:otp:*');
    for (const key of keys) await redis.pExpire(key, 1);
    await new Promise(resolve => setTimeout(resolve, 5));
    await assert.rejects(store.verify(expired.challengeId, otp));
    await request();
    await assert.rejects(request(), { code: 'OWNERSHIP_RATE_LIMITED' });
  } finally { await redis.quit(); }
});
test('resends invalidate old codes, grants cannot extend expiry, delivery and Redis failures fail closed', { skip: !url }, async () => {
  assert.equal(url, 'redis://127.0.0.1:55449/15');
  const redis = createClient({ url }); await redis.connect();
  const secret = 'isolated-ownership-expiry-secret-123456789012345', store = new OwnershipProofStore(redis, secret);
  const email = `${randomUUID()}@example.test`; let code;
  const send = async value => { code = value; };
  try {
    const first = await store.request({ purpose: 'REGISTER', email, address: randomUUID(), snapshot: null, send }), firstCode = code;
    const second = await store.request({ purpose: 'REGISTER', email: email.toUpperCase(), address: randomUUID(), snapshot: null, send });
    await assert.rejects(store.verify(first.challengeId, firstCode));
    const token = (await store.verify(second.challengeId, code)).token;
    const digest = value => createHmac('sha256', secret).update(`ownership:v1:${value}`).digest('hex');
    const key = `auth:ownership:grant:${digest(token)}`;
    assert.ok(await redis.pTTL(key) <= 300000);
    await redis.pExpire(key, 1); await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(await store.consume(token, 'REGISTER'), null);
    const rejected = await store.request({ purpose: 'REGISTER', email, address: randomUUID(), snapshot: null, send: async value => { code = value; throw new Error('provider unavailable'); } });
    await new Promise(resolve => setTimeout(resolve, 20));
    await assert.rejects(store.verify(rejected.challengeId, code));
    const offline = createClient({ url });
    await assert.rejects(new OwnershipProofStore(offline, secret).verify(second.challengeId, '123456'), { code: 'AUTH_TEMPORARILY_UNAVAILABLE' });
  } finally { await redis.quit(); }
});
