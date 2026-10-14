import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { createApp } from '../dist/app.js';
import { createPrisma } from '../dist/lib/prisma.js';
import { HealthService } from '../dist/modules/health/health.service.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { TokenService } from '../dist/modules/auth/token.service.js';
import { UserRepository } from '../dist/modules/auth/user.repository.js';
import { createCatalog } from '../dist/modules/catalog/create-catalog.js';

const url = process.env.AUTH_TEST_DATABASE_URL;
test('PostgreSQL catalog: relationships, filters, duplicate races, constraints and admin revocation', { skip: !url, timeout: 30000 }, async () => {
  assert.match(new URL(url).pathname, /_test$/);
  const prisma = createPrisma(url);
  const run = randomUUID();
  const userId = randomUUID();
  const cityIds = [], theatreIds = [], screenIds = [], movieIds = [];
  const tokens = new TokenService({ secret: 'catalog-integration-only-key-1234567890123456', expiresInSeconds: 3600 });
  const app = createApp({ frontendOrigin: 'http://localhost:5173', catalog: createCatalog(prisma),
    auth: { service: new AuthService(new UserRepository(prisma), tokens), tokens },
    healthService: new HealthService({ checkDatabase: async () => { await prisma.$queryRaw`SELECT 1`; }, checkRedis: async () => {} }) });
  const token = tokens.sign({ userId, role: 'ADMIN' });
  const post = (path, body) => request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
  try {
    await prisma.user.create({ data: { id: userId, name: 'Catalog integration', email: `catalog-${run}@example.com`, role: 'ADMIN', passwordHash: await bcrypt.hash('integration-only-password', 12) } });
    const cityBody = { name: `City ${run}`, state: 'Test State' };
    const cityRace = await Promise.all([post('/api/admin/cities', cityBody), post('/api/admin/cities', { ...cityBody, name: cityBody.name.toUpperCase() })]);
    assert.deepEqual(cityRace.map(x => x.status).sort(), [201, 409]);
    const cityId = cityRace.find(x => x.status === 201).body.data.city.id;
    cityIds.push(cityId);
    const theatreBody = { name: 'PVR', address: 'Test road', cityId };
    const theatreRace = await Promise.all([post('/api/admin/theatres', theatreBody), post('/api/admin/theatres', { ...theatreBody, name: 'pvr' })]);
    assert.deepEqual(theatreRace.map(x => x.status).sort(), [201, 409]);
    const theatreId = theatreRace.find(x => x.status === 201).body.data.theatre.id;
    theatreIds.push(theatreId);
    const screenBody = { name: 'Screen 1', capacity: 100, theatreId };
    const screenRace = await Promise.all([post('/api/admin/screens', screenBody), post('/api/admin/screens', { ...screenBody, name: 'screen 1' })]);
    assert.deepEqual(screenRace.map(x => x.status).sort(), [201, 409]);
    screenIds.push(screenRace.find(x => x.status === 201).body.data.screen.id);
    const detail = await request(app).get(`/api/theatres/${theatreId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.theatre.city.id, cityId);
    assert.equal(detail.body.data.theatre.screens.length, 1);
    assert.equal((await request(app).get(`/api/theatres?cityId=${cityId}`)).body.data.items.length, 1);
    await assert.rejects(prisma.city.delete({ where: { id: cityId } }));
    await assert.rejects(prisma.screen.update({ where: { id: screenIds[0] }, data: { capacity: 0 } }));
    await assert.rejects(prisma.theatre.create({ data: { name: 'Orphan', address: 'Road', cityId: randomUUID() } }));
    const movieBody = { title: `Movie ${run} 100%_`, description: 'Integration', durationMinutes: 100, releaseDate: '2026-01-01', language: 'English', genres: ['Drama'] };
    const movie = await post('/api/admin/movies', movieBody);
    assert.equal(movie.status, 201);
    movieIds.push(movie.body.data.movie.id);
    const decoy = await post('/api/admin/movies', { ...movieBody, title: `Movie ${run} 100XY` });
    assert.equal(decoy.status, 201);
    movieIds.push(decoy.body.data.movie.id);
    const search = await request(app).get('/api/movies').query({ search: '100%_', language: 'ENGLISH', genre: 'DRAMA' });
    assert.deepEqual(search.body.data.items.map(x => x.id), [movieIds[0]]);
    assert.equal((await request(app).get('/api/movies').query({ search: run, language: 'hindi' })).body.data.items.length, 0);
    const patched = await request(app).patch(`/api/admin/screens/${screenIds[0]}`).set('Authorization', `Bearer ${token}`).send({ capacity: 120 });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.data.screen.capacity, 120);
    const disabled = await request(app).delete(`/api/admin/movies/${movieIds[0]}`).set('Authorization', `Bearer ${token}`);
    assert.equal(disabled.status, 200);
    assert.equal((await request(app).get(`/api/movies/${movieIds[0]}`)).status, 404);
    assert.equal((await prisma.movie.findUniqueOrThrow({ where: { id: movieIds[0] } })).isActive, false);
    await prisma.user.update({ where: { id: userId }, data: { role: 'USER' } });
    assert.equal((await post('/api/admin/movies', movieBody)).status, 403);
  } finally {
    try {
      // Every deletion names only rows belonging to this test run, child-first.
      await prisma.screen.deleteMany({ where: { id: { in: screenIds } } });
      await prisma.theatre.deleteMany({ where: { id: { in: theatreIds } } });
      await prisma.city.deleteMany({ where: { id: { in: cityIds } } });
      await prisma.movie.deleteMany({ where: { id: { in: movieIds } } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } finally { await prisma.$disconnect(); }
  }
});
