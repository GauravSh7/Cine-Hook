import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createPrisma } from '../dist/lib/prisma.js';
import { createApp } from '../dist/app.js';
import { createCatalog } from '../dist/modules/catalog/create-catalog.js';
import { UserRepository } from '../dist/modules/auth/user.repository.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { TokenService } from '../dist/modules/auth/token.service.js';
import { AccountRepository } from '../dist/modules/account/account.repository.js';
import { AccountService } from '../dist/modules/account/account.service.js';
import { CloudinaryProvider } from '../dist/modules/account/cloudinary.provider.js';
import { createWishlist } from '../dist/modules/wishlist/create-wishlist.js';

const connection = process.env.PROFILE_TEST_DATABASE_URL;
if (connection) {
  const target = new URL(connection);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
      !target.pathname.endsWith('_test') || target.search || target.hash) {
    throw new Error('Profile integration requires an explicit loopback *_test target.');
  }
}

test('real PostgreSQL account and wishlist HTTP contracts', { skip: !connection }, async t => {
  const prisma = createPrisma(connection);
  const ids = [], movies = [];
  let server;
  try {
    const identity = await prisma.$queryRaw`SELECT current_database() AS name`;
    assert.equal(identity[0].name, new URL(connection).pathname.slice(1));
    const tokens = new TokenService({ secret: 'profile-integration-only-signing-key-1234567890', expiresInSeconds: 3600 });
    const auth = { service: new AuthService(new UserRepository(prisma), tokens), tokens };
    const transportCalls = [];
    const provider = new CloudinaryProvider({ cloudName: 'cinehook-test', apiKey: 'integration-only', apiSecret: 'integration-only-secret' }, async (url, options) => {
      const id = options.body.get('public_id');
      transportCalls.push({ path: new URL(url).pathname, id });
      if (String(url).endsWith('/destroy')) return Response.json({ result: 'ok' });
      return Response.json({ public_id: id, secure_url: `https://res.cloudinary.com/cinehook-test/image/upload/v1/${id}.webp` });
    });
    const app = createApp({ frontendOrigin: 'http://localhost:5173', healthService: {}, auth,
      catalog: createCatalog(prisma), account: new AccountService(new AccountRepository(prisma), provider),
      wishlist: createWishlist(prisma) });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, token, method = 'GET', body) => {
      const headers = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
      const response = await fetch(origin + path, { method, headers,
        body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    const users = [];
    for (let n = 0; n < 2; n++) {
      const result = await request('/api/auth/register', null, 'POST', { name: `Profile integration ${n}`,
        email: `profile-${randomUUID()}@cinehook.test`, password: 'Integration-only-password!123' });
      assert.equal(result.status, 201);
      ids.push(result.data.data.user.id);
      users.push(result.data.data);
    }
    const movie = await prisma.movie.create({ data: { title: `Wishlist integration ${randomUUID()}`,
      description: 'Explicitly isolated test-only film.', durationMinutes: 100,
      releaseDate: new Date('2024-01-01'), language: 'english', genres: ['drama'] } });
    movies.push(movie.id);
    const token = users[0].accessToken, other = users[1].accessToken;

    await t.test('strict owner profile persists DOB/phone/name without changing email or leaking hash', async () => {
      const unauth = await request('/api/account/profile', null, 'PATCH', { name: 'Not saved' });
      assert.equal(unauth.status, 401);
      const forbidden = await request('/api/account/profile', token, 'PATCH', { email: 'other@cinehook.test', role: 'ADMIN' });
      assert.equal(forbidden.status, 400);
      const saved = await request('/api/account/profile', token, 'PATCH', { name: 'Owner updated', dateOfBirth: '2000-02-29', phone: '+919876543210' });
      assert.equal(saved.status, 200);
      const me = (await request('/api/auth/me', token)).data.data.user;
      assert.equal(me.name, 'Owner updated'); assert.equal(me.dateOfBirth, '2000-02-29');
      assert.equal(me.phone, '+919876543210'); assert.equal(me.email, users[0].user.email);
      assert.equal('age' in me, false); assert.equal('passwordHash' in me, false); assert.equal('avatarPublicId' in me, false);
      assert.equal((await request('/api/auth/me', other)).data.data.user.name, 'Profile integration 1');
      for (const dob of ['2001-02-29', '2999-01-01', '2000-02-29T00:00:00Z']) {
        assert.equal((await request('/api/account/profile', token, 'PATCH', { dateOfBirth: dob })).status, 400);
      }
      assert.equal((await request('/api/account/profile', token, 'PATCH', { dateOfBirth: null, phone: null })).status, 200);
    });

    await t.test('concurrent idempotent saves produce one owned row, disabled history remains removable', async () => {
      const path = `/api/wishlist/movies/${movie.id}`;
      const attempts = await Promise.all(Array.from({ length: 12 }, () => request(path, token, 'PUT', {})));
      for (const result of attempts) assert.ok([200, 201].includes(result.status));
      assert.equal(await prisma.movieWishlist.count({ where: { userId: ids[0], movieId: movie.id } }), 1);
      assert.equal((await request(path, token)).data.data.saved, true);
      assert.equal((await request(path, other)).data.data.saved, false);
      assert.equal((await request(path, other, 'PUT', { userId: ids[0] })).status, 400);
      assert.equal((await request('/api/wishlist/movies', other)).data.data.items.length, 0);
      await prisma.movie.update({ where: { id: movie.id }, data: { isActive: false } });
      const history = (await request('/api/wishlist/movies', token)).data.data.items;
      assert.equal(history.length, 1); assert.equal(history[0].movie.isActive, false);
      assert.equal((await request(path, other, 'PUT', {})).status, 404);
      assert.equal((await request('/api/wishlist/movies?limit=101', token)).status, 400);
      assert.equal((await request(path, token, 'DELETE')).status, 200);
      assert.equal((await request(path, token, 'DELETE')).status, 200);
      assert.equal(await prisma.movieWishlist.count({ where: { userId: ids[0] } }), 0);
    });

    await t.test('decoded image upload and replacement persist only public URL; malformed data leaves avatar intact', async () => {
      const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ff1529' } }).png().toBuffer();
      const imageForm = bytes => { const form = new FormData(); form.set('image', new Blob([bytes], { type: 'image/png' }), 'profile.png'); return form; };
      assert.equal((await request('/api/account/avatar', null, 'POST', imageForm(png))).status, 401);
      assert.equal(transportCalls.length, 0);
      const first = await request('/api/account/avatar', token, 'POST', imageForm(png));
      assert.equal(first.status, 200);
      const firstUrl = (await request('/api/auth/me', token)).data.data.user.avatarUrl;
      assert.match(firstUrl, /^https:\/\/res\.cloudinary\.com\/cinehook-test\//);
      const invalid = await request('/api/account/avatar', token, 'POST', imageForm(Buffer.from('<svg></svg>')));
      assert.ok([400, 415, 422].includes(invalid.status));
      assert.equal((await request('/api/auth/me', token)).data.data.user.avatarUrl, firstUrl);
      assert.equal((await request('/api/account/avatar', token, 'POST', imageForm(png))).status, 200);
      const next = (await request('/api/auth/me', token)).data.data.user;
      assert.notEqual(next.avatarUrl, firstUrl); assert.equal('avatarPublicId' in next, false);
      assert.ok(transportCalls.some(call => call.path.endsWith('/destroy')));
      assert.equal((await request('/api/auth/me', other)).data.data.user.avatarUrl, null);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    // Only explicitly recorded test-owned rows; never reset/flush/delete user data.
    await prisma.movieWishlist.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.movie.deleteMany({ where: { id: { in: movies } } });
    await prisma.$disconnect();
  }
});
