import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { HealthService } from '../src/modules/health/health.service.js';
import { testCatalog } from './helpers/catalog.js';

const movie = { title: 'Interstellar', description: 'Space exploration', durationMinutes: 169,
  releaseDate: '2014-11-07', language: 'English', genres: ['Sci-Fi'], posterUrl: null };
function setup(role: 'USER' | 'ADMIN' | null = 'ADMIN', tokenRole: 'USER' | 'ADMIN' = 'ADMIN') {
  const id = randomUUID();
  const tokens = new TokenService({ secret: 'catalog-test-only-secret-12345678901234567890', expiresInSeconds: 3600 });
  const service = new AuthService({ create: async () => { throw new Error('unused'); }, findByEmail: async () => null,
    findById: async () => role ? { id, role, name: 'Admin', email: 'admin@example.com', createdAt: new Date(), updatedAt: new Date() } : null }, tokens);
  const catalog = testCatalog();
  const app = createApp({ frontendOrigin: 'http://localhost:5173', auth: { service, tokens }, catalog: catalog.services,
    healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }) });
  return { app, catalog, token: tokens.sign({ userId: id, role: tokenRole }) };
}
async function post(app: ReturnType<typeof createApp>, token: string, path: string, body: object) {
  return request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
}

describe('movie catalog', () => {
  it('creates, publicly reads, updates and soft-disables a movie', async () => {
    const { app, token, catalog } = setup();
    const created = await post(app, token, '/api/admin/movies', movie);
    expect(created.status).toBe(201);
    const id = created.body.data.movie.id;
    expect(created.body.data.movie.genres).toEqual(['sci-fi']);
    const list = await request(app).get('/api/movies?search=INTER&language=ENGLISH&genre=SCI-FI');
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((x: { id: string }) => x.id)).toEqual([id]);
    expect((await request(app).get(`/api/movies/${id}`)).status).toBe(200);
    const updated = await request(app).patch(`/api/admin/movies/${id}`).set('Authorization', `Bearer ${token}`).send({ title: 'Interstellar revised' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.movie.durationMinutes).toBe(169);
    expect((await request(app).delete(`/api/admin/movies/${id}`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await request(app).delete(`/api/admin/movies/${id}`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect(catalog.movies.get(id)!.isActive).toBe(false);
    expect((await request(app).get(`/api/movies/${id}`)).status).toBe(404);
    expect((await request(app).get('/api/movies')).body.data.items).toEqual([]);
  });
  it.each([
    { ...movie, durationMinutes: 0 }, { ...movie, releaseDate: '2026-02-30' },
    { ...movie, releaseDate: '0000-01-01' },
    { ...movie, genres: [] }, { ...movie, posterUrl: 'javascript:alert(1)' },
    { ...movie, posterUrl: 'not-a-url' },
    { ...movie, isActive: false }, { ...movie, title: '' },
  ])('rejects invalid movie input', async body => {
    const { app, token } = setup();
    expect((await post(app, token, '/api/admin/movies', body)).status).toBe(400);
  });
  it.each(['/api/movies/not-a-uuid', '/api/movies?page=0', '/api/movies?limit=101', '/api/movies?search=a&search=b', '/api/movies?unknown=x'])('rejects invalid read request %s', async path => {
    expect((await request(setup().app).get(path)).status).toBe(400);
  });
  it('returns 404 for absent records and rejects empty patches', async () => {
    const { app, token } = setup();
    expect((await request(app).get(`/api/movies/${randomUUID()}`)).status).toBe(404);
    expect((await request(app).patch(`/api/admin/movies/${randomUUID()}`).set('Authorization', `Bearer ${token}`).send({ title: 'Missing' })).status).toBe(404);
    expect((await request(app).patch(`/api/admin/movies/${randomUUID()}`).set('Authorization', `Bearer ${token}`).send({})).status).toBe(400);
  });
  it('uses bounded pagination', async () => {
    const { app, token } = setup();
    for (const title of ['A', 'B', 'C']) await post(app, token, '/api/admin/movies', { ...movie, title });
    const response = await request(app).get('/api/movies?page=2&limit=1');
    expect(response.body.data.items.map((x: { title: string }) => x.title)).toEqual(['B']);
    expect(response.body.data).toMatchObject({ page: 2, limit: 1 });
  });
});

describe('admin access', () => {
  const paths = ['/api/admin/movies', '/api/admin/cities', '/api/admin/theatres', '/api/admin/screens'];
  it.each(paths)('requires authentication for %s', async path => {
    expect((await request(setup().app).post(path).send({})).status).toBe(401);
  });
  it.each(paths)('uses current DB role for %s even with an old ADMIN JWT', async path => {
    const { app, token } = setup('USER', 'ADMIN');
    expect((await post(app, token, path, {})).status).toBe(403);
  });
  it('rejects a deleted admin and accepts a current admin with an older USER claim', async () => {
    const deleted = setup(null);
    expect((await post(deleted.app, deleted.token, '/api/admin/movies', movie)).status).toBe(401);
    const promoted = setup('ADMIN', 'USER');
    expect((await post(promoted.app, promoted.token, '/api/admin/movies', movie)).status).toBe(201);
  });
  it.each(['patch', 'delete'] as const)('protects movie %s', async method => {
    const { app, token } = setup('USER');
    const req = request(app)[method](`/api/admin/movies/${randomUUID()}`).set('Authorization', `Bearer ${token}`);
    expect((await req.send({ title: 'Forbidden' })).status).toBe(403);
  });
  it.each(['theatres', 'screens'])('protects %s updates', async resource => {
    const { app, token } = setup('USER');
    expect((await request(app).patch(`/api/admin/${resource}/${randomUUID()}`).set('Authorization', `Bearer ${token}`).send({ name: 'Forbidden' })).status).toBe(403);
  });
});

describe('venues', () => {
  it('creates City -> Theatre -> Screen and reads theatre detail', async () => {
    const { app, token } = setup();
    const city = await post(app, token, '/api/admin/cities', { name: 'Mumbai', state: 'Maharashtra' });
    expect(city.status).toBe(201);
    const cityId = city.body.data.city.id;
    const theatre = await post(app, token, '/api/admin/theatres', { name: 'PVR', address: 'Main road', cityId });
    expect(theatre.status).toBe(201);
    const theatreId = theatre.body.data.theatre.id;
    const screen = await post(app, token, '/api/admin/screens', { name: 'Screen 1', capacity: 100, theatreId });
    expect(screen.status).toBe(201);
    const detail = await request(app).get(`/api/theatres/${theatreId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.theatre.city.id).toBe(cityId);
    expect(detail.body.data.theatre.screens[0].capacity).toBe(100);
    expect((await request(app).get(`/api/theatres?cityId=${cityId}`)).body.data.items).toHaveLength(1);
    expect((await request(app).get(`/api/theatres?cityId=${randomUUID()}`)).body.data.items).toEqual([]);
    expect((await request(app).get('/api/cities')).body.data.items).toHaveLength(1);
    const updated = await request(app).patch(`/api/admin/theatres/${theatreId}`).set('Authorization', `Bearer ${token}`).send({ address: 'New address' });
    expect(updated.body.data.theatre.address).toBe('New address');
    const updatedScreen = await request(app).patch(`/api/admin/screens/${screen.body.data.screen.id}`).set('Authorization', `Bearer ${token}`).send({ capacity: 120 });
    expect(updatedScreen.body.data.screen.capacity).toBe(120);
    expect((await post(app, token, '/api/admin/cities', { name: 'mumbai', state: 'maharashtra' })).status).toBe(409);
    expect((await post(app, token, '/api/admin/theatres', { name: 'pvr', address: 'Duplicate', cityId })).status).toBe(409);
    expect((await post(app, token, '/api/admin/screens', { name: 'screen 1', capacity: 50, theatreId })).status).toBe(409);
  });
  it('searches the full city directory by city name and state without requiring booking inventory', async () => {
    const { app, token } = setup();
    const city = await post(app, token, '/api/admin/cities', { name: 'Muzaffarnagar', state: 'Uttar Pradesh' });
    expect(city.status).toBe(201);
    const result = await request(app).get('/api/cities').query({ search: 'muzaffarnagar', state: 'Uttar Pradesh', limit: 30 });
    expect(result.status).toBe(200);
    expect(result.body.data.items.map((item: { name: string }) => item.name)).toEqual(['Muzaffarnagar']);
    expect((await request(app).get('/api/cities').query({ search: 'muzaffarnagar', state: 'Maharashtra' })).body.data.items).toEqual([]);
    expect((await request(app).get('/api/cities?search=a&search=b')).status).toBe(400);
  });
  it('rejects absent parent IDs without creating orphan venues', async () => {
    const { app, token } = setup();
    expect((await post(app, token, '/api/admin/theatres', { name: 'PVR', address: 'Road', cityId: randomUUID() })).status).toBe(404);
    expect((await post(app, token, '/api/admin/screens', { name: 'Screen 1', capacity: 100, theatreId: randomUUID() })).status).toBe(404);
    expect((await request(app).get(`/api/theatres/${randomUUID()}`)).status).toBe(404);
  });
  it('rejects invalid venue/query input', async () => {
    const { app, token } = setup();
    expect((await post(app, token, '/api/admin/screens', { name: 'A', capacity: -1, theatreId: randomUUID() })).status).toBe(400);
    expect((await request(app).get('/api/theatres?cityId=no')).status).toBe(400);
    expect((await post(app, token, '/api/admin/theatres', { name: 'A', address: '', cityId: randomUUID() })).status).toBe(400);
  });
  it('supports blank city filters as no filter', async () => {
    expect((await request(setup().app).get('/api/theatres?cityId=')).status).toBe(200);
  });
  it('keeps name uniqueness scoped to the parent and protects relationship updates', async () => {
    const { app, token } = setup();
    const cityA = (await post(app, token, '/api/admin/cities', { name: 'Same City', state: 'State A' })).body.data.city.id;
    const cityB = (await post(app, token, '/api/admin/cities', { name: 'Same City', state: 'State B' })).body.data.city.id;
    const theatreA = (await post(app, token, '/api/admin/theatres', { name: 'PVR', address: 'Road', cityId: cityA })).body.data.theatre.id;
    const theatreB = await post(app, token, '/api/admin/theatres', { name: 'PVR', address: 'Road', cityId: cityB });
    expect(theatreB.status).toBe(201);
    expect((await post(app, token, '/api/admin/screens', { name: 'Screen 1', capacity: 100, theatreId: theatreA })).status).toBe(201);
    expect((await post(app, token, '/api/admin/screens', { name: 'Screen 1', capacity: 100, theatreId: theatreB.body.data.theatre.id })).status).toBe(201);
    const collision = await request(app).patch(`/api/admin/theatres/${theatreA}`).set('Authorization', `Bearer ${token}`).send({ cityId: cityB });
    expect(collision.status).toBe(409);
    const missing = await request(app).patch(`/api/admin/theatres/${theatreA}`).set('Authorization', `Bearer ${token}`).send({ cityId: randomUUID() });
    expect(missing.status).toBe(404);
    expect((await request(app).get(`/api/theatres/${theatreA}`)).body.data.theatre.city.id).toBe(cityA);
  });
});
