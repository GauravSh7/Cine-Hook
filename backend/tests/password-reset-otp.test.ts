import { expect, it, vi } from 'vitest';
import bcrypt from 'bcrypt';
import { PasswordResetService } from '../src/modules/auth/password-reset.service.js';

it('emails an OTP, verifies it before resetting, rejects the old password and revokes sessions', async () => {
  let passwordHash = await bcrypt.hash('old-password', 4);
  const user = () => ({ id: 'user-id', email: 'user@example.com', passwordHash });
  let delivered = '';
  const revoke = vi.fn(async () => {});
  const values = new Map<string, unknown>();
  const store = { allowRequest: async () => true,
    save: async (key: string, value: unknown) => { values.set(key, value); },
    consume: async (key: string) => { const value = values.get(key); values.delete(key); return value; },
    peek: async (key: string) => values.get(key),
    saveOtp: vi.fn(async (key, value) => { values.set(key, value); }),
    verifyOtp: vi.fn(async (key, digest, grantKey) => {
      const value = values.get(key) as { digest: string; userId: string; credentialTag: string } | undefined;
      if (!value || value.digest !== digest) return false;
      values.delete(key); values.set(grantKey, { userId: value.userId, credentialTag: value.credentialTag }); return true;
    }),
  };
  const service = new PasswordResetService({ findByEmail: async () => user(), findById: async () => user(),
    replacePassword: async (_id, expected, next) => { if (expected !== passwordHash) return false; passwordHash = next; return true; } },
    store as never, { revoke, valid: async () => true }, { secret: 'otp-test-secret', frontendOrigin: 'https://cinehook.example',
      mailer: { sendResetLink: async () => {}, sendOtp: async (_email: string, otp: string) => { delivered = otp; } } });
  const request = await service.requestOtp('user@example.com', '127.0.0.1');
  expect(delivered).toMatch(/^\d{6}$/);
  expect(store.saveOtp).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ attempts: 0 }), 600);
  await expect(service.verifyOtp(request.challengeId, '000000' === delivered ? '000001' : '000000')).rejects.toMatchObject({ code: 'PASSWORD_RESET_INVALID' });
  const grant = await service.verifyOtp(request.challengeId, delivered);
  await expect(service.reset(grant.token, 'old-password')).rejects.toMatchObject({ code: 'PASSWORD_REUSED' });
  expect(revoke).not.toHaveBeenCalled();
  await service.reset(grant.token, 'new-password');
  expect(await bcrypt.compare('new-password', passwordHash)).toBe(true);
  expect(revoke).toHaveBeenCalledOnce();
  await expect(service.reset(grant.token, 'third-password')).rejects.toMatchObject({ code: 'PASSWORD_RESET_INVALID' });
  store.allowRequest = async () => false;
  await expect(service.requestOtp('user@example.com', '127.0.0.1')).rejects.toMatchObject({ code: 'PASSWORD_RESET_RATE_LIMITED', status: 429 });
});
