import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { PasswordResetStore } from '../src/modules/auth/password-reset.store.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { credentialTag } from '../src/modules/auth/password-credential.js';

it('rejects an old-password token minted during recovery, even after the revocation timestamp', async () => {
  const values = new Map<string, string>();
  const redis = { isReady: true, get: async (key: string) => values.get(key) ?? null,
    getDel: async (key: string) => { const value = values.get(key) ?? null; values.delete(key); return value; },
    set: async (key: string, value: string) => { values.set(key, value); return 'OK'; }, eval: async () => 1 };
  const secret = 'unit-recovery-session-secret-only-1234567890', userId = randomUUID();
  const oldHash = 'old-bcrypt-credential', newHash = 'new-bcrypt-credential';
  const store = new PasswordResetStore(redis, async () => credentialTag(secret, newHash));
  const tokens = new TokenService({ secret, expiresInSeconds: 86400, sessions: store });
  const resetTime = Date.now() - 100;
  values.set(`auth:revoked-before:${userId}`, JSON.stringify({ time: resetTime }));
  const stale = tokens.sign({ userId, role: 'USER' }, resetTime + 1, oldHash);
  await expect(tokens.verifySession(stale)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  const fresh = tokens.sign({ userId, role: 'USER' }, resetTime + 2, newHash);
  await expect(tokens.verifySession(fresh)).resolves.toEqual({ userId, role: 'USER' });
  const oldSession = tokens.sign({ userId, role: 'USER' }, resetTime - 1, oldHash);
  await expect(tokens.verifySession(oldSession)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
});

it('consumes a recovery token exactly once and refuses authentication if Redis is unavailable', async () => {
  const values = new Map<string, string>();
  const redis = { isReady: true, get: async (key: string) => values.get(key) ?? null,
    getDel: async (key: string) => { const value = values.get(key) ?? null; values.delete(key); return value; },
    set: async (key: string, value: string) => { values.set(key, value); return 'OK'; }, eval: async () => 1 };
  const store = new PasswordResetStore(redis);
  const evidence = { userId: randomUUID(), credentialTag: 'a'.repeat(64) };
  await store.save('hashed-token', evidence, 900);
  const results = await Promise.all([store.consume('hashed-token'), store.consume('hashed-token')]);
  expect(results.filter(Boolean)).toEqual([evidence]);
  redis.isReady = false;
  await expect(store.valid(evidence.userId, Date.now())).rejects.toMatchObject({ code: 'AUTH_TEMPORARILY_UNAVAILABLE' });
});
