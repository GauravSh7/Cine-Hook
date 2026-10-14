import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import request from 'supertest';
import { CloudinaryProvider } from '../src/modules/account/cloudinary.provider.js';
import { accountFixture, cloudConfig } from './helpers/account-wishlist.js';
afterEach(() => { vi.useRealTimers(); });
const publicId = 'cinehook/avatars/user/unique';
const url = `https://res.cloudinary.com/cinehook-test/image/upload/v1/${publicId}.webp`;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
it('signs upload and deletion on the server and sends only re-encoded image bytes', async () => {
  const forms: FormData[] = []; const urls: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    urls.push(String(input)); forms.push(init!.body as FormData);
    return response(String(input).endsWith('/upload') ? { public_id: publicId, secure_url: url } : { result: 'ok' });
  };
  const provider = new CloudinaryProvider(cloudConfig, transport);
  expect(await provider.upload(Buffer.from('test-image'), publicId)).toEqual({ publicId, url });
  await provider.remove(publicId);
  expect(urls).toEqual(['https://api.cloudinary.com/v1_1/cinehook-test/image/upload', 'https://api.cloudinary.com/v1_1/cinehook-test/image/destroy']);
  expect([...forms[0]!.keys()].sort()).toEqual(['api_key', 'file', 'overwrite', 'public_id', 'signature', 'timestamp']);
  expect(forms[0]!.get('overwrite')).toBe('false');
  expect(forms[1]!.get('invalidate')).toBe('true');
  expect(forms[0]!.get('api_key')).toBe('test-key');
  expect(forms[0]!.get('signature')).toBe(createHash('sha1').update(`overwrite=false&public_id=${publicId}&timestamp=${forms[0]!.get('timestamp')}test-provider-secret`).digest('hex'));
  expect(forms[1]!.get('signature')).toBe(createHash('sha1').update(`invalidate=true&public_id=${publicId}&timestamp=${forms[1]!.get('timestamp')}test-provider-secret`).digest('hex'));
  expect(forms[0]!.has('api_secret')).toBe(false);
  expect((forms[0]!.get('file') as Blob).type).toBe('image/webp');
});
it.each([
  { public_id: 'someone-else', secure_url: url },
  { public_id: publicId, secure_url: 'http://res.cloudinary.com/cinehook-test/image/upload/x' },
  { public_id: publicId, secure_url: 'https://evil.test/cinehook-test/image/upload/x' },
  { public_id: publicId, secure_url: 'https://res.cloudinary.com/other-cloud/image/upload/x' },
  { public_id: publicId, secure_url: 'https://res.cloudinary.com/cinehook-test/other/x' },
  { public_id: publicId, secure_url: 'https://res.cloudinary.com/cinehook-test/image/upload/' },
  { public_id: publicId, secure_url: `https://res.cloudinary.com:8443/cinehook-test/image/upload/x` },
  { public_id: publicId, secure_url: `https://user:pass@res.cloudinary.com/cinehook-test/image/upload/x` },
  { public_id: publicId, secure_url: `${url}?secret=x` },
  { public_id: publicId, secure_url: `${url}#x` },
  { public_id: publicId }, null,
])('rejects invalid provider result %j', async value => {
  const provider = new CloudinaryProvider(cloudConfig, async () => response(value));
  await expect(provider.upload(Buffer.from('image'), publicId)).rejects.toMatchObject({ status: 502, code: 'AVATAR_PROVIDER_ERROR' });
});
it.each(['reject', 'http-error', 'bad-json'])('maps %s to a safe provider error without secrets', async mode => {
  const provider = new CloudinaryProvider(cloudConfig, async () => {
    if (mode === 'reject') throw new Error('private API secret');
    return mode === 'http-error' ? response({ error: 'private API secret' }, 500) : new Response('private API secret');
  });
  await expect(provider.upload(Buffer.from('image'), publicId)).rejects.toMatchObject({ status: 502, message: 'Photo service could not complete the request.' });
});
it.each(['upload', 'delete'] as const)('bounds %s transport to ten seconds even if it ignores AbortSignal', async action => {
  vi.useFakeTimers(); let signal: AbortSignal | null | undefined;
  const provider = new CloudinaryProvider(cloudConfig, async (_input, init) => { signal = init?.signal; return await new Promise<Response>(() => {}); });
  const promise = action === 'upload' ? provider.upload(Buffer.from('image'), publicId) : provider.remove(publicId);
  const assertion = expect(promise).rejects.toMatchObject({ status: 504, code: 'AVATAR_PROVIDER_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(9999); expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await assertion; expect(signal?.aborted).toBe(true);
});
it('also bounds parsing of the provider response body', async () => {
  vi.useFakeTimers();
  const provider = new CloudinaryProvider(cloudConfig, async () => new Response(new ReadableStream({ start() {} })));
  const assertion = expect(provider.upload(Buffer.from('image'), publicId)).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(10_000); await assertion;
});
it.each(['error', 'wrong-id', 'wrong-url'])('preserves stored old avatar when provider returns %s', async mode => {
  const f = accountFixture({ transport: async (_url, init) => {
    if (mode === 'error') throw new Error('provider secret');
    const id = (init!.body as FormData).get('public_id');
    return response({ public_id: mode === 'wrong-id' ? 'wrong' : id,
      secure_url: mode === 'wrong-url' ? 'https://evil.test/avatar.webp' : url });
  } });
  const old = f.user.avatarUrl; const oldId = f.user.avatarPublicId;
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  const result = await request(f.app).post('/api/account/avatar').set('Authorization', f.authorization()).attach('image', png, 'x.png');
  expect(result.status).toBe(502); expect(f.user.avatarUrl).toBe(old); expect(f.user.avatarPublicId).toBe(oldId);
  expect(result.text).not.toContain('provider secret');
});
it('keeps a successful replacement when deleting the old image fails', async () => {
  const f = accountFixture({ transport: async (url, init) => {
    if (String(url).endsWith('/destroy')) throw new Error('delete failed');
    const publicId = (init!.body as FormData).get('public_id');
    return response({ public_id: publicId, secure_url: `https://res.cloudinary.com/cinehook-test/image/upload/${publicId}.webp` });
  } });
  const old = f.user.avatarUrl;
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  const result = await request(f.app).post('/api/account/avatar').set('Authorization', f.authorization()).attach('image', png, 'x.png');
  expect(result.status).toBe(200); expect(f.user.avatarUrl).not.toBe(old);
});
it('preserves the stored avatar when a real provider upload reaches its deadline', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const f = accountFixture({ transport: async () => { started(); return await new Promise<Response>(() => {}); } });
  const oldId = f.user.avatarPublicId; const oldUrl = f.user.avatarUrl;
  vi.useFakeTimers();
  const assertion = expect(f.account.uploadAvatar(f.user.id, png, 'image/png')).rejects.toMatchObject({ status: 504 });
  await ready;
  await vi.advanceTimersByTimeAsync(10_000); await assertion;
  expect(f.user.avatarPublicId).toBe(oldId); expect(f.user.avatarUrl).toBe(oldUrl);
});
