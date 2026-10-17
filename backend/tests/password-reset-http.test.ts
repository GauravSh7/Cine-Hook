import { expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { HealthService } from '../src/modules/health/health.service.js';
import { testCatalog } from './helpers/catalog.js';
import { PasswordResetService } from '../src/modules/auth/password-reset.service.js';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import type { RecoveryOtp, RecoveryToken } from '../src/modules/auth/password-reset.types.js';

it('provides a safe recovery error when email delivery is not configured', async () => {
  const tokens = new TokenService({ secret: 'reset-test-secret-only-123456789012345', expiresInSeconds: 86400 });
  const service = new AuthService({ create: async () => { throw new Error('unused'); }, findByEmail: async () => null, findById: async () => null }, tokens);
  const app = createApp({ frontendOrigin: 'http://localhost:5173', auth: { service, tokens }, catalog: testCatalog().services,
    healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }) });
  const response = await request(app).post('/api/auth/forgot-password').set('Origin', 'http://localhost:5173').send({ email: 'nobody@example.com' });
  expect(response.status).toBe(503);
  expect(response.body.error.code).toBe('PASSWORD_RESET_UNAVAILABLE');
  expect(JSON.stringify(response.body)).not.toMatch(/token|passwordHash|connectionString/);
});

it('exposes OTP verification without disclosing the code and protects its request origin', async () => {
  const tokens = new TokenService({ secret: 'reset-http-secret-only-123456789012345', expiresInSeconds: 86400 });
  const user = { id: randomUUID(), email: 'reset@example.com', passwordHash: await bcrypt.hash('old-password', 4) };
  let otp = '';
  const challenges = new Map<string, RecoveryOtp>(), grants = new Map<string, RecoveryToken>();
  const recovery = new PasswordResetService({ findByEmail: async email => email === user.email ? user : null,
    findById: async () => user, replacePassword: async () => true }, {
    allowRequest: async () => true, save: async (key, value) => { grants.set(key, value); },
    consume: async key => { const value = grants.get(key) ?? null; grants.delete(key); return value; },
    saveOtp: async (key, value) => { challenges.set(key, value); },
    verifyOtp: async (key, digest, grant) => {
      const value = challenges.get(key); if (!value || value.digest !== digest) return false;
      challenges.delete(key); grants.set(grant, { userId: value.userId, credentialTag: value.credentialTag }); return true;
    },
  }, { valid: async () => true, revoke: async () => {} }, {
    secret: 'http-otp-secret', frontendOrigin: 'http://localhost:5173',
    mailer: { sendResetLink: async () => {}, sendOtp: async (_email, code) => { otp = code; } },
  });
  const service = new AuthService({ create: async () => { throw Error('unused'); }, findByEmail: async () => null, findById: async () => null }, tokens);
  const app = createApp({ frontendOrigin: 'http://localhost:5173', auth: { service, tokens, recovery }, catalog: testCatalog().services,
    healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }) });
  const initial = await request(app).post('/api/auth/forgot-password').send({ email: user.email });
  expect(initial.status).toBe(202); expect(initial.body.data.challengeId).toHaveLength(43);
  expect(initial.body.data).not.toHaveProperty('otp'); expect(initial.body.data).not.toHaveProperty('token');
  const body = { challengeId: initial.body.data.challengeId, otp };
  const forbidden = await request(app).post('/api/auth/verify-reset-otp').set('Origin', 'https://untrusted.example').send(body);
  expect(forbidden.status).toBe(403);
  const verified = await request(app).post('/api/auth/verify-reset-otp').set('Origin', 'http://localhost:5173').send(body);
  expect(verified.status).toBe(200); expect(verified.body.data.token).toHaveLength(43);
  expect(verified.headers['cache-control']).toBe('no-store');
  expect((await request(app).post('/api/auth/verify-reset-otp').send(body)).status).toBe(400);
  expect((await request(app).post('/api/auth/verify-reset-otp').send({ ...body, otp: 'bad' })).status).toBe(400);
});
