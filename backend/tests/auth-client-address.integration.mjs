import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { OwnershipService } from '../src/modules/auth/ownership.service.ts';
import { OwnershipProofStore } from '../src/modules/auth/ownership-proof.store.ts';

test('real auth routes enforce Redis quotas across direct/proxied clients, forged headers and shared IPs', async () => {
  assert.equal(process.env.OWNERSHIP_PROOF_TEST_REDIS_URL, 'redis://127.0.0.1:55449/15');
  const redis = createClient({ url: process.env.OWNERSHIP_PROOF_TEST_REDIS_URL }); await redis.connect();
  const ownership = new OwnershipService({ findByEmail: async () => null },
    new OwnershipProofStore(redis, randomUUID()), {}, { secret: randomUUID(), mailer: { sendVerificationCode: async () => {} } });
  const app = createApp({ frontendOrigin: 'https://cinehook.test',
    authTrustedProxyCidrs: ['127.0.0.1/32', '198.51.100.10/32'],
    healthService: {}, catalog: {}, auth: { service: {}, tokens: {}, ownership } });
  const post = (ip, email = `${randomUUID()}@example.test`, path = '/ownership/request') => request(app)
    .post('/api/auth' + path).set('X-Forwarded-For', ip).set('X-Real-IP', randomUUID())
    .set('X-Vercel-Forwarded-For', randomUUID()).set('Origin', 'https://cinehook.test')
    .send(path === '/forgot-password' ? { email } : { purpose: 'REGISTER', email });
  try {
    // Two browser clients sharing one public IP consume the same network quota.
    for (let i = 0; i < 100; i++) assert.equal((await post(`${i}.1.2.3, 192.0.2.1`)).status, 200);
    assert.equal((await post('203.0.113.99, 192.0.2.1')).status, 429);
    assert.equal((await post('192.0.2.1', undefined, '/forgot-password')).status, 429);
    // Independent direct and Vercel-proxied clients are not in that bucket.
    assert.equal((await post('192.0.2.2')).status, 200);
    assert.equal((await post('192.0.2.3, 198.51.100.10')).status, 200);
    // Mailbox limit remains shared across client addresses and purposes.
    const email = `${randomUUID()}@example.test`;
    for (let i = 0; i < 5; i++) assert.equal((await post(`203.0.113.${i + 1}`, email)).status, 200);
    assert.equal((await post('203.0.113.8', email, '/forgot-password')).status, 429);
    // Without an authenticated/trusted socket peer, forwarded identities do not
    // distinguish clients: all remain in the conservative socket bucket.
    const untrusted = createApp({ frontendOrigin: 'https://cinehook.test', healthService: {}, catalog: {},
      auth: { service: {}, tokens: {}, ownership } });
    for (let i = 0; i < 100; i++) assert.equal((await request(untrusted).post('/api/auth/ownership/request')
      .set('X-Forwarded-For', `192.0.2.${i + 1}`).send({ purpose: 'REGISTER', email: `${randomUUID()}@example.test` })).status, 200);
    assert.equal((await request(untrusted).post('/api/auth/forgot-password')
      .set('X-Forwarded-For', '203.0.113.99').send({ email: `${randomUUID()}@example.test` })).status, 429);
  } finally { await redis.quit(); }
});
