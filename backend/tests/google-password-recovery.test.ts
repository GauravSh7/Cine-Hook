import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { expect, it, vi } from 'vitest';
import { PasswordResetService } from '../src/modules/auth/password-reset.service.js';
import { PasswordResetRepository } from '../src/modules/auth/password-reset.repository.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { GoogleAuthService } from '../src/modules/auth/google/google.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import type { PasswordRecoveryStore, RecoveryOtp, RecoveryToken } from '../src/modules/auth/password-reset.types.js';

function fixture() {
  const record = { id: randomUUID(), email: 'google@example.com', googleSubject: 'verified-google-subject' as string | null,
    passwordHash: null as string | null, name: 'Google User', role: 'USER' as const, createdAt: new Date(), updatedAt: new Date(),
    bookings: ['existing-booking'], wishlist: ['existing-movie'] };
  const grants = new Map<string, RecoveryToken>(), challenges = new Map<string, RecoveryOtp>();
  let delivered = '';
  const sendOtp = vi.fn(async (_email: string, code: string) => { delivered = code; });
  const revoke = vi.fn(async () => {});
  const replacePassword = vi.fn(async (id: string, expected: string | null, next: string) => {
    if (id !== record.id || expected !== record.passwordHash) return false;
    record.passwordHash = next; return true;
  });
  const store: PasswordRecoveryStore = { allowRequest: async () => true,
    save: async (key, value) => { grants.set(key, value); }, peek: async key => grants.get(key) ?? null,
    consume: async key => { const value = grants.get(key) ?? null; grants.delete(key); return value; },
    saveOtp: async (key, value) => { challenges.set(key, value); },
    verifyOtp: async (key, digest, grant) => {
      const value = challenges.get(key); if (!value || value.digest !== digest) return false;
      challenges.delete(key); grants.set(grant, { userId: value.userId, credentialTag: value.credentialTag }); return true;
    },
  };
  const service = new PasswordResetService({ findByEmail: async email => email === record.email ? { ...record } : null,
    findById: async id => id === record.id ? { ...record } : null, replacePassword }, store,
    { valid: async () => true, revoke }, { secret: 'test-only-google-password-setup', frontendOrigin: 'https://cinehook.example',
      mailer: { sendResetLink: async () => {}, sendOtp } });
  const proof = async () => {
    const response = await service.requestOtp(record.email, '127.0.0.1');
    expect(delivered).toMatch(/^\d{6}$/);
    return service.verifyOtp(response.challengeId, delivered);
  };
  return { record, service, proof, sendOtp, replacePassword, revoke };
}

it('creates a password only after email OTP verification, preserving the Google identity and account data', async () => {
  const f = fixture(), original = structuredClone(f.record);
  await expect(f.service.reset('x'.repeat(43), 'first-password')).rejects.toMatchObject({ code: 'PASSWORD_RESET_INVALID' });
  expect(f.replacePassword).not.toHaveBeenCalled();
  const proof = await f.proof();
  await f.service.reset(proof.token, 'first-password');
  expect(await bcrypt.compare('first-password', f.record.passwordHash!)).toBe(true);
  expect(f.replacePassword).toHaveBeenCalledWith(original.id, null, expect.any(String));
  expect(f.record).toMatchObject({ id: original.id, email: original.email, googleSubject: original.googleSubject,
    bookings: original.bookings, wishlist: original.wishlist });
  expect(f.revoke).toHaveBeenCalledWith(original.id, expect.any(String));
  await expect(f.service.reset(proof.token, 'second-password')).rejects.toMatchObject({ code: 'PASSWORD_RESET_INVALID' });
});

it('invalidates setup proof if a password was set by another request', async () => {
  const f = fixture(), proof = await f.proof();
  f.record.passwordHash = await bcrypt.hash('another-password', 4);
  await expect(f.service.reset(proof.token, 'first-password')).rejects.toMatchObject({ code: 'PASSWORD_RESET_INVALID' });
  expect(f.replacePassword).not.toHaveBeenCalled();
});

it('invalidates setup proof if its Google identity is removed or replaced', async () => {
  const f = fixture(), proof = await f.proof();
  f.record.googleSubject = 'another-google-subject';
  await expect(f.service.reset(proof.token, 'first-password')).rejects.toMatchObject({ code: 'PASSWORD_RESET_INVALID' });
  expect(f.replacePassword).not.toHaveBeenCalled();
});

it('does not reveal unknown or unusable accounts and does not create an account', async () => {
  const f = fixture(); f.record.googleSubject = null;
  const unusable = await f.service.requestOtp(f.record.email, '127.0.0.1');
  const unknown = await f.service.requestOtp('unknown@example.com', '127.0.0.1');
  expect(unusable.message).toBe(unknown.message);
  expect(f.sendOtp).not.toHaveBeenCalled(); expect(f.replacePassword).not.toHaveBeenCalled();
});

it('allows at most one password initialization across concurrent verified grants', async () => {
  const f = fixture(), first = await f.proof(), second = await f.proof();
  const results = await Promise.allSettled([f.service.reset(first.token, 'first-password'), f.service.reset(second.token, 'second-password')]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(f.record.googleSubject).toBe('verified-google-subject');
});

it('retains password login and an existing verified Google identity on the same account after setup', async () => {
  const f = fixture(), proof = await f.proof();
  await f.service.reset(proof.token, 'first-password');
  const tokens = new TokenService({ secret: 'test-only-dual-login-secret-12345678901234567890', expiresInSeconds: 3600 });
  const auth = new AuthService({ create: async () => { throw Error('must not create a user'); },
    findByEmail: async () => ({ ...f.record }), findById: async () => ({ ...f.record }) }, tokens);
  const passwordLogin = await auth.login({ email: f.record.email, password: 'first-password' });
  expect(passwordLogin.user.id).toBe(f.record.id);
  expect(passwordLogin.user).not.toHaveProperty('passwordHash');
  const nonce = 'n'.repeat(43), clientId = 'test.apps.googleusercontent.com', now = Math.floor(Date.now() / 1000);
  const google = new GoogleAuthService({ findBySubject: async sub => sub === f.record.googleSubject ? { ...f.record } : null,
    findByEmail: async () => ({ ...f.record }), createGoogle: async () => { throw Error('must not create a user'); } },
    { verify: async () => ({ sub: f.record.googleSubject, email: f.record.email, email_verified: true,
      aud: clientId, iss: 'https://accounts.google.com', iat: now, exp: now + 3600, nonce }) }, tokens, clientId);
  const googleLogin = await google.login('provider-token-verified-by-external-adapter', nonce);
  expect(googleLogin.user.id).toBe(passwordLogin.user.id);
  expect(googleLogin.user).not.toHaveProperty('passwordHash');
  expect(tokens.verify(googleLogin.accessToken).userId).toBe(f.record.id);
});

it('uses a conditional null-password update and never writes the Google subject or account relationships', async () => {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const repository = new PasswordResetRepository({ user: { updateMany } } as never);
  expect(await repository.replacePassword('existing-user', null, 'new-bcrypt-hash')).toBe(true);
  expect(updateMany).toHaveBeenCalledWith({ where: { id: 'existing-user', passwordHash: null, googleSubject: { not: null } },
    data: { passwordHash: 'new-bcrypt-hash' } });
});
