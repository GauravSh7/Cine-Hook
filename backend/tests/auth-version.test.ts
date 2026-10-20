import { expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { TokenService } from '../src/modules/auth/token.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import bcrypt from 'bcrypt';
const secret = 'unit-auth-version-secret-only-1234567890123456789';
const userId = '10000000-0000-4000-8000-000000000001';
it('rejects signed legacy JWTs without a durable auth version', () => {
  const tokens = new TokenService({ secret, expiresInSeconds: 600 });
  const legacy = jwt.sign({ userId, role: 'USER' }, secret, { issuer: 'cinehook', audience: 'cinehook-api', expiresIn: 600 });
  expect(() => tokens.verify(legacy)).toThrow();
});
it('does not activate password registration without mailbox proof', async () => {
  let created = false;
  const service = new AuthService({ create: async () => { created = true; return {} as never; }, findByEmail: async () => null, findById: async () => null }, new TokenService({ secret, expiresInSeconds: 600 }));
  await expect(service.register({ name: 'Attacker', email: 'owner@example.test', password: 'attacker-password-123' })).rejects.toMatchObject({ code: 'EMAIL_VERIFICATION_REQUIRED' });
  expect(created).toBe(false);
});
it('rejects unverified password login without returning private account data', async () => {
  const record = { id: userId, name: 'Private', email: 'owner@example.test', role: 'USER' as const, createdAt: new Date(), updatedAt: new Date(), passwordHash: await bcrypt.hash('correct-password', 4), emailVerifiedAt: null, authVersion: 0, authDisabledAt: null };
  const service = new AuthService({ create: async () => record, findByEmail: async () => record, findById: async () => record }, new TokenService({ secret, expiresInSeconds: 600 }));
  await expect(service.login({ email: record.email, password: 'correct-password' })).rejects.toMatchObject({ code: 'EMAIL_VERIFICATION_REQUIRED' });
});
it('rejects stale versions, disabled and unverified accounts after Redis revocation state is gone', async () => {
  let snapshot: any = { id: userId, role: 'USER', authVersion: 2, authDisabledAt: null, emailVerifiedAt: new Date() };
  const tokens = new TokenService({ secret, expiresInSeconds: 600, currentAuth: async () => snapshot });
  const stale = tokens.sign({ userId, role: 'USER', authVersion: 1 });
  await expect(tokens.verifySession(stale)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  const fresh = tokens.sign({ userId, role: 'USER', authVersion: 2 });
  await expect(tokens.verifySession(fresh)).resolves.toEqual({ userId, role: 'USER' });
  snapshot.authDisabledAt = new Date();
  await expect(tokens.verifySession(fresh)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  snapshot.authDisabledAt = null; snapshot.emailVerifiedAt = null;
  await expect(tokens.verifySession(fresh)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  snapshot = null;
  await expect(tokens.verifySession(fresh)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
});
