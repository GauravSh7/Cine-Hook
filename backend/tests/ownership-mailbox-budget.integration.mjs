import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { OwnershipService } from '../src/modules/auth/ownership.service.ts';
import { OwnershipProofStore } from '../src/modules/auth/ownership-proof.store.ts';

test('mailbox-budget fallback avoids shared-proxy lockout but atomically bounds all mail sends', async () => {
  assert.equal(process.env.OWNERSHIP_PROOF_TEST_REDIS_URL, 'redis://127.0.0.1:55449/15');
  const redis = createClient({ url: process.env.OWNERSHIP_PROOF_TEST_REDIS_URL }); await redis.connect();
  let sends = 0;
  const store = new OwnershipProofStore(redis, randomUUID(), { dailyEmailBudget: 130 });
  const ownership = new OwnershipService({ findByEmail: async () => null }, store, {},
    { secret: randomUUID(), mailer: { sendVerificationCode: async () => { sends++; } } });
  const app = createApp({ frontendOrigin: 'https://cinehook.test', healthService: {}, catalog: {}, auth: { service: {}, tokens: {}, ownership } });
  const post = (email = `${randomUUID()}@example.test`, path = '/ownership/request') => request(app).post('/api/auth' + path)
    .set('X-Forwarded-For', randomUUID()).set('X-Vercel-Forwarded-For', randomUUID())
    .send(path === '/forgot-password' ? { email } : { purpose: 'REGISTER', email });
  try {
    // More than 100 distinct legitimate mailboxes behind the identical socket
    // must not trip the old shared-proxy network quota.
    for (let i = 0; i < 101; i++) assert.equal((await post()).status, 200);
    const email = `${randomUUID()}@example.test`;
    for (let i = 0; i < 5; i++) assert.equal((await post(email)).status, 200);
    assert.equal((await post(email, '/forgot-password')).status, 429);
    const race = await Promise.all(Array.from({ length: 40 }, () => post()));
    assert.equal(race.filter(r => r.status === 200).length, 24);
    assert.equal(race.filter(r => r.status === 429).length, 16);
    assert.equal(sends, 130);
    assert.equal((await post()).status, 429, 'cookie/header rotation cannot reset shared send budget');
    const secondWorker = new OwnershipProofStore(redis, storeSecret, { dailyEmailBudget: 2 });
    let sent = 0, code;
    const emit = () => secondWorker.request({ purpose: 'REGISTER', email: `${randomUUID()}@example.test`, address: randomUUID(), snapshot: null, send: async value => { sent++; code = value; } });
    const first = await emit();
    const anotherWorker = new OwnershipProofStore(redis, storeSecret, { dailyEmailBudget: 2 });
    await anotherWorker.request({ purpose: 'RESET_PASSWORD', email: `${randomUUID()}@example.test`, address: 'other', snapshot: null, send: async () => { sent++; } });
    await assert.rejects(emit(), { code: 'OWNERSHIP_RATE_LIMITED' });
    assert.equal(sent, 2);
    // Exhausting send budget must not stop already-issued OTP verification.
    const proof = await secondWorker.verify(first.challengeId, code);
    assert.ok(await secondWorker.consume(proof.token, 'REGISTER'));
    assert.equal(await secondWorker.consume(proof.token, 'REGISTER'), null);
  } finally { await redis.quit(); }
});
const storeSecret = randomUUID();
