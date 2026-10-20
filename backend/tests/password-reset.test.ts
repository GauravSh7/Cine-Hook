import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { beforeAll, expect, it, vi } from 'vitest';
import { PasswordResetService } from '../src/modules/auth/password-reset.service.js';
import { BrevoRecoveryMailer } from '../src/modules/auth/password-reset.mailer.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import type { RecoveryToken } from '../src/modules/auth/password-reset.types.js';

let hash: string;
beforeAll(async () => { hash = await bcrypt.hash('old-secret-password', 4); });
function fixture() {
  const record = { id: randomUUID(), email: 'reset@example.com', passwordHash: hash as string | null, emailVerifiedAt: new Date(), authVersion: 0, authDisabledAt: null as Date | null };
  const tokens = new Map<string, { value: RecoveryToken; expiresAt: number }>();
  const sent: string[] = [], revoked: string[] = [];
  const users = { findByEmail: async (email: string) => email === record.email ? { ...record } : null,
    findById: async (id: string) => id === record.id ? { ...record } : null,
    replacePassword: async (id: string, expected: string, next: string) => {
      if (id !== record.id || record.passwordHash !== expected) return false;
      record.passwordHash = next; return true;
    } };
  const store = { allowRequest: async () => true, save: async (key: string, value: RecoveryToken, seconds: number) => {
    tokens.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
  }, consume: async (key: string) => { const value = tokens.get(key); tokens.delete(key); return value && value.expiresAt > Date.now() ? value.value : null; } };
  const sessions = { revoke: async (id: string) => { revoked.push(id); }, valid: async () => true };
  const options = { secret: 'test-only-credential-binding-secret', frontendOrigin: 'https://cinehook.example', mailer: { sendResetLink: async (_email: string, url: string) => { sent.push(url); } } };
  const service = new PasswordResetService(users, store, sessions, options);
  const token = () => new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get('token')!;
  return { service, users, store, sessions, options, record, tokens, sent, revoked, token };
}
it('legacy reset never activates an unverified account or exposes its history', async () => {
  const f = fixture(); f.record.emailVerifiedAt = null as never;
  await f.service.request(f.record.email, '127.0.0.1');
  expect(f.sent).toHaveLength(0);
});
it('labels ownership emails with the requested action rather than disguising clean start as password reset', async () => {
  let body: any;
  const mailer = new BrevoRecoveryMailer({ apiKey: 'isolated-brevo-key', from: 'sender@example.test' }, async (_url, options) => {
    body = JSON.parse(String(options?.body)); return new Response(JSON.stringify({ messageId: 'isolated-message' }), { status: 201 });
  });
  await mailer.sendVerificationCode('owner@example.test', '123456', 'CLEAN_START');
  expect(body.subject).toMatch(/clean account/i); expect(body.textContent).toMatch(/history.*not.*transfer/i);
  expect(body.textContent).toContain('123456'); expect(body.textContent).toContain('10 minutes');
});

it('sends a fragment-only expiring link, stores only a digest and resets using bcrypt once', async () => {
  const f = fixture();
  const result = await f.service.request(f.record.email, '127.0.0.1');
  expect(result).toEqual(await f.service.request('unknown@example.com', '127.0.0.1'));
  expect(f.sent).toHaveLength(1);
  const url = new URL(f.sent[0]!); expect(url.origin).toBe('https://cinehook.example'); expect(url.pathname).toBe('/reset-password'); expect(url.search).toBe('');
  expect([...f.tokens.keys()]).not.toContain(f.token()); expect(JSON.stringify([...f.tokens.values()])).not.toContain(hash);
  await f.service.reset(f.token(), 'new-secret-password');
  expect(await bcrypt.compare('new-secret-password', f.record.passwordHash!)).toBe(true);
  expect(f.revoked).toEqual([f.record.id]);
  await expect(f.service.reset(f.token(), 'another-secret-password')).rejects.toMatchObject({ code: 'PASSWORD_RESET_INVALID' });
});
it('rejects expired, invented and replaced-credential reset links', async () => {
  const f = fixture(); await f.service.request(f.record.email, '127.0.0.1');
  for (const entry of f.tokens.values()) entry.expiresAt = Date.now() - 1;
  await expect(f.service.reset(f.token(), 'new-secret-password')).rejects.toMatchObject({ code: 'PASSWORD_RESET_INVALID' });
  await expect(f.service.reset('x'.repeat(43), 'new-secret-password')).rejects.toMatchObject({ code: 'PASSWORD_RESET_INVALID' });
  await f.service.request(f.record.email, '127.0.0.1'); f.record.passwordHash = 'a-changed-credential';
  await expect(f.service.reset(f.token(), 'new-secret-password')).rejects.toMatchObject({ code: 'PASSWORD_RESET_INVALID' });
});
it('allows at most one concurrent reset, including two different links for the old credential', async () => {
  const f = fixture(); await f.service.request(f.record.email, '127.0.0.1'); const first = f.token();
  await f.service.request(f.record.email, '127.0.0.1'); const second = f.token();
  const results = await Promise.allSettled([f.service.reset(first, 'first-new-password'), f.service.reset(second, 'second-new-password')]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
});
it('does not mail Google-only accounts, expose account existence or deliver rate-limited requests', async () => {
  const f = fixture(); f.record.passwordHash = null;
  const response = await f.service.request(f.record.email, '127.0.0.1');
  expect(response).toEqual(await f.service.request('other@example.com', '127.0.0.1')); expect(f.sent).toEqual([]);
  f.record.passwordHash = hash; f.store.allowRequest = async () => false;
  expect(await f.service.request(f.record.email, '127.0.0.1')).toEqual(response); expect(f.sent).toEqual([]);
});
it('keeps provider failure neutral and never logs an email, recovery link or secret', async () => {
  const f = fixture(), log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  f.options.mailer.sendResetLink = async () => { throw new Error('provider private detail'); };
  expect(await f.service.request(f.record.email, '127.0.0.1')).toEqual(await f.service.request('other@example.com', '127.0.0.1'));
  expect(f.tokens.size).toBe(0); expect(log).toHaveBeenCalledWith('{"event":"password_recovery_delivery_failed"}');
  log.mockRestore();
});
it('rejects validly signed access from before credential recovery but accepts a fresh session', async () => {
  const f = fixture(); const signed = new TokenService({ secret: f.options.secret, expiresInSeconds: 86400 });
  const token = signed.sign({ userId: f.record.id, role: 'USER' });
  const denied = new TokenService({ secret: f.options.secret, expiresInSeconds: 86400, sessions: { revoke: async () => {}, valid: async () => false } });
  await expect(denied.verifySession(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  expect(await signed.verifySession(token)).toEqual({ userId: f.record.id, role: 'USER' });
});
it('sends recovery through the Brevo HTTPS API to each requested user', async () => {
  let sent: Record<string, unknown> = {};
  const sender = new BrevoRecoveryMailer({ apiKey: 'private-test-key', from: 'recovery@cinehook.example' }, async (input, init) => {
    expect(input).toBe('https://api.brevo.com/v3/smtp/email'); sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(new Headers(init?.headers).get('api-key')).toBe('private-test-key');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    return new Response('{"messageId":"<delivery-1@brevo.example>"}', { status: 201 });
  });
  await sender.sendResetLink('reset@example.com', 'https://cinehook.example/reset-password#token=private');
  expect(sent.to).toEqual([{ email: 'reset@example.com' }]); expect(sent.textContent).toContain('expires in 15 minutes');
  expect(sent.sender).toEqual({ email: 'recovery@cinehook.example', name: 'CineHook' });
  await sender.sendResetLink('second@example.net', 'https://cinehook.example/reset-password#token=second-private');
  expect(sent.to).toEqual([{ email: 'second@example.net' }]);
  const failing = new BrevoRecoveryMailer({ apiKey: 'private', from: 'recovery@cinehook.example' }, async () => new Response('sensitive failure', { status: 403 }));
  await expect(failing.sendResetLink('reset@example.com', 'https://cinehook.example')).rejects.toThrow('Password recovery email delivery failed.');
});

it.each([
  [401, 'unauthorized', 'BREVO_AUTH_REJECTED'],
  [400, 'sender not verified', 'BREVO_SENDER_REJECTED'],
  [403, 'account not activated', 'BREVO_ACCOUNT_NOT_ACTIVATED'],
  [400, 'quota exceeded', 'BREVO_QUOTA_EXCEEDED'],
  [429, 'slow down', 'BREVO_RATE_LIMITED'],
  [503, 'temporarily unavailable', 'BREVO_UNAVAILABLE'],
])('classifies Brevo %s safely without exposing provider details', async (status, message, code) => {
  const mailer = new BrevoRecoveryMailer({ apiKey: 'private', from: 'recovery@cinehook.example' }, async () =>
    new Response(JSON.stringify({ message: `${message} private-recipient@example.com` }), { status }));
  await expect(mailer.sendResetLink('reset@example.com', 'https://cinehook.example')).rejects.toMatchObject({
    code, message: 'Password recovery email delivery failed.',
  });
});

it('does not treat a malformed successful response as accepted delivery', async () => {
  const mailer = new BrevoRecoveryMailer({ apiKey: 'private', from: 'recovery@cinehook.example' }, async () =>
    new Response('{}', { status: 201 }));
  await expect(mailer.sendResetLink('reset@example.com', 'https://cinehook.example')).rejects.toMatchObject({ code: 'BREVO_DELIVERY_REJECTED' });
});
