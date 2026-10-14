import { expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { crc32 } from 'node:zlib';
import { accountFixture } from './helpers/account-wishlist.js';

it('updates only the authenticated profile and returns nullable/date-only safe fields', async () => {
  const f = accountFixture();
  const result = await request(f.app).patch('/api/account/profile').set('Authorization', f.authorization())
    .send({ name: ' New name ', dateOfBirth: '2000-02-29', phone: '+919876543210' });
  expect(result.status).toBe(200);
  expect(result.body.data.user).toMatchObject({ id: f.user.id, name: 'New name', dateOfBirth: '2000-02-29', phone: '+919876543210', email: 'viewer@example.com' });
  expect(result.body.data.user).not.toHaveProperty('avatarPublicId');
  expect(result.body.data.user).not.toHaveProperty('passwordHash');
  expect(f.other.name).toBe('Other');
  expect(result.headers['cache-control']).toBe('no-store');
  const clear = await request(f.app).patch('/api/account/profile').set('Authorization', f.authorization()).send({ dateOfBirth: null, phone: null });
  expect(clear.status).toBe(200); expect(clear.body.data.user).toMatchObject({ dateOfBirth: null, phone: null, name: 'New name' });
  const me = await request(f.app).get('/api/auth/me').set('Authorization', f.authorization());
  expect(me.body.data.user.name).toBe('New name');
});
it.each([{}, { name: '' }, { name: ' '.repeat(3) }, { name: 'a'.repeat(101) }, { dateOfBirth: '2001-02-29' },
  { dateOfBirth: '2999-01-01' }, { dateOfBirth: '0000-01-01' }, { dateOfBirth: '2000-01-01T00:00:00Z' },
  { phone: '9876543210' }, { phone: '+0123456789' }, { phone: '+1234567' }, { phone: '+1234567890123456' },
  { email: 'new@example.com' }, { role: 'ADMIN' }, { age: 20 }, { userId: 'other' }, { avatarUrl: 'https://evil.test/x' }])('rejects invalid/read-only profile fields %j', async body => {
  const f = accountFixture();
  const result = await request(f.app).patch('/api/account/profile').set('Authorization', f.authorization()).send(body);
  expect(result.status).toBe(400); expect(f.user.name).toBe('Viewer'); expect(f.user.phone).toBeNull();
});
it('requires current-user authentication before multipart validation', async () => {
  const f = accountFixture();
  const unauth = await request(f.app).post('/api/account/avatar').attach('wrong', Buffer.from('bad'), 'bad.gif');
  expect(unauth.status).toBe(401); expect(f.operations).toHaveLength(0);
  const header = f.authorization(); f.users.delete(f.user.id);
  const deleted = await request(f.app).post('/api/account/avatar').set('Authorization', header).attach('wrong', Buffer.from('bad'), 'bad.gif');
  expect(deleted.status).toBe(401); expect(f.operations).toHaveLength(0);
});
it.each(['jpeg', 'png', 'webp'] as const)('decodes %s, strips metadata, resizes WebP and replaces only current avatar', async format => {
  const f = accountFixture(); const old = f.user.avatarPublicId;
  const image = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#ff0000' } }).withMetadata().toFormat(format).toBuffer();
  const response = await request(f.app).post('/api/account/avatar').set('Authorization', f.authorization()).attach('image', image, { filename: `image.${format}`, contentType: `image/${format}` });
  expect(response.status).toBe(200);
  expect(response.body.data.user.avatarUrl).toContain('/cinehook/avatars/');
  expect(response.body.data.user).not.toHaveProperty('avatarPublicId'); expect(response.body.data.user).not.toHaveProperty('passwordHash');
  const uploaded = f.operations.find(x => x.action === 'upload')!;
  const metadata = await sharp(Buffer.from(await uploaded.image!.arrayBuffer())).metadata();
  expect(metadata.format).toBe('webp'); expect(metadata.width).toBe(512); expect(metadata.height).toBe(256);
  expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined();
  expect(f.operations.filter(x => x.action === 'destroy').map(x => x.publicId)).toEqual([old]);
  expect(f.other.avatarPublicId).toContain('old/'); expect(response.headers['cache-control']).toBe('no-store');
});
it.each([
  { content: Buffer.from('corrupt'), type: 'image/jpeg' },
  { content: Buffer.from('<svg/>'), type: 'image/svg+xml' },
  { content: Buffer.from('GIF89a'), type: 'image/gif' },
])('rejects corruption and unsupported types before provider upload', async value => {
  const f = accountFixture(); const old = f.user.avatarUrl;
  const response = await request(f.app).post('/api/account/avatar').set('Authorization', f.authorization()).attach('image', value.content, { filename: 'bad', contentType: value.type });
  expect(response.status).toBe(400); expect(f.operations).toHaveLength(0); expect(f.user.avatarUrl).toBe(old);
});
it('rejects MIME spoofing and oversized decoded dimensions', async () => {
  const f = accountFixture();
  for (const [width, type] of [[40, 'image/jpeg'], [4097, 'image/png'], [4096, 'image/png']] as const) {
    const image = await sharp({ create: { width, height: width === 4096 ? 4096 : 1, channels: 3, background: '#123456' } }).png().toBuffer();
    const response = await request(f.app).post('/api/account/avatar').set('Authorization', f.authorization()).attach('image', image, { filename: 'bad.png', contentType: type });
    expect(response.status).toBe(400);
  }
  expect(f.operations).toHaveLength(0);
});
it('rejects an animated WebP after actual decode', async () => {
  const f = accountFixture();
  const frames = Buffer.alloc(2 * 2 * 3 * 2, 120);
  frames.fill(255, 12);
  const image = await sharp(frames, { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  expect((await sharp(image, { animated: true }).metadata()).pages).toBe(2);
  const response = await request(f.app).post('/api/account/avatar').set('Authorization', f.authorization()).attach('image', image, { filename: 'animated.webp', contentType: 'image/webp' });
  expect(response.status).toBe(400); expect(f.operations).toHaveLength(0);
});
it('rejects a single-frame animated WebP container despite reporting only one page', async () => {
  const f = accountFixture(); const oldUrl = f.user.avatarUrl;
  const frames = Buffer.alloc(24, 120); frames.fill(255, 12);
  const animated = await sharp(frames, { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  // Keep the animation container/ANIM metadata but retain only its first ANMF.
  // Recompute the RIFF size so this remains a valid, actually decoded WebP.
  const chunks: Buffer[] = []; let keptFrame = false;
  for (let offset = 12; offset < animated.length;) {
    const size = animated.readUInt32LE(offset + 4); const end = offset + 8 + size + (size % 2);
    if (animated.toString('ascii', offset, offset + 4) !== 'ANMF' || !keptFrame) {
      chunks.push(animated.subarray(offset, end));
      if (animated.toString('ascii', offset, offset + 4) === 'ANMF') keptFrame = true;
    }
    offset = end;
  }
  const image = Buffer.concat([animated.subarray(0, 12), ...chunks]); image.writeUInt32LE(image.length - 8, 4);
  expect(await sharp(image, { animated: true }).metadata()).toMatchObject({ format: 'webp', pages: 1, loop: 0, delay: [100] });
  const response = await request(f.app).post('/api/account/avatar').set('Authorization', f.authorization()).attach('image', image, { filename: 'one-frame.webp', contentType: 'image/webp' });
  expect(response.status).toBe(400); expect(response.body.error.code).toBe('INVALID_IMAGE');
  expect(f.operations).toHaveLength(0); expect(f.user.avatarUrl).toBe(oldUrl);
});
it('rejects animated PNG even when the image decoder exposes only its first frame', async () => {
  const f = accountFixture();
  const chunk = (type: string, data: Buffer) => {
    const buffer = Buffer.alloc(data.length + 12); buffer.writeUInt32BE(data.length, 0); buffer.write(type, 4, 'ascii'); data.copy(buffer, 8);
    buffer.writeUInt32BE(crc32(buffer.subarray(4, -4)), buffer.length - 4); return buffer;
  };
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  const chunks: { type: string; buffer: Buffer; data: Buffer }[] = [];
  for (let at = 8; at < png.length;) {
    const size = png.readUInt32BE(at); chunks.push({ type: png.toString('ascii', at + 4, at + 8), buffer: png.subarray(at, at + size + 12), data: png.subarray(at + 8, at + size + 8) }); at += size + 12;
  }
  const control = Buffer.alloc(8); control.writeUInt32BE(2);
  const frame = (seq: number) => { const data = Buffer.alloc(26); data.writeUInt32BE(seq); data.writeUInt32BE(2, 4); data.writeUInt32BE(2, 8); data.writeUInt16BE(1, 20); data.writeUInt16BE(10, 22); return chunk('fcTL', data); };
  const compressed = Buffer.concat(chunks.filter(x => x.type === 'IDAT').map(x => x.data));
  const sequence = Buffer.alloc(4); sequence.writeUInt32BE(2);
  const image = Buffer.concat([png.subarray(0, 8), chunks.find(x => x.type === 'IHDR')!.buffer, chunk('acTL', control), frame(0),
    ...chunks.filter(x => x.type !== 'IHDR' && x.type !== 'IEND').map(x => x.buffer), frame(1), chunk('fdAT', Buffer.concat([sequence, compressed])), chunks.find(x => x.type === 'IEND')!.buffer]);
  expect((await sharp(image).metadata()).format).toBe('png');
  const result = await request(f.app).post('/api/account/avatar').set('Authorization', f.authorization()).attach('image', image, { filename: 'animated.png', contentType: 'image/png' });
  expect(result.status).toBe(400); expect(f.operations).toHaveLength(0);
});
it('rejects byte overflow, multiple files, wrong file name and text fields', async () => {
  const f = accountFixture(); const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  const big = await request(f.app).post('/api/account/avatar').set('Authorization', f.authorization()).attach('image', Buffer.alloc(3 * 1024 * 1024 + 1), { filename: 'big.jpg', contentType: 'image/jpeg' });
  expect(big.status).toBe(413);
  const multi = await request(f.app).post('/api/account/avatar').set('Authorization', f.authorization()).attach('image', png, 'a.png').attach('image', png, 'b.png');
  expect(multi.status).toBe(400);
  const wrong = await request(f.app).post('/api/account/avatar').set('Authorization', f.authorization()).attach('file', png, 'a.png');
  expect(wrong.status).toBe(400);
  const fields = await request(f.app).post('/api/account/avatar').set('Authorization', f.authorization()).field('userId', f.other.id).attach('image', png, 'a.png');
  expect(fields.status).toBe(400); expect(f.operations).toHaveLength(0);
});
it('fails unavailable provider with 503 while leaving profile and previous avatar usable', async () => {
  const f = accountFixture({ provider: false }); const old = f.user.avatarUrl;
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
  const response = await request(f.app).post('/api/account/avatar').set('Authorization', f.authorization()).attach('image', png, 'x.png');
  expect(response.status).toBe(503); expect(f.user.avatarUrl).toBe(old);
  expect((await request(f.app).patch('/api/account/profile').set('Authorization', f.authorization()).send({ name: 'Usable' })).status).toBe(200);
});
it('preserves old avatar on database failure and deletes a confirmed orphan', async () => {
  const f = accountFixture(); const old = f.user.avatarPublicId; f.failSwap();
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
  await expect(f.account.uploadAvatar(f.user.id, png, 'image/png')).rejects.toThrow('database unavailable');
  expect(f.user.avatarPublicId).toBe(old);
  const uploaded = f.operations.find(x => x.action === 'upload')!;
  expect(f.operations.filter(x => x.action === 'destroy').map(x => x.publicId)).toEqual([uploaded.publicId]);
});
it('retains an orphan when commit outcome cannot be checked safely', async () => {
  const f = accountFixture(); f.failSwap(); f.failRead();
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
  await expect(f.account.uploadAvatar(f.user.id, png, 'image/png')).rejects.toThrow('database unavailable');
  expect(f.operations.map(x => x.action)).toEqual(['upload']);
});
