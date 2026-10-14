import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Response } from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { HealthService } from '../src/modules/health/health.service.js';
import { testCatalog } from './helpers/catalog.js';
import { testShows } from './helpers/shows.js';

const secret = 'shows-test-only-secret-12345678901234567890';
const layout = { seats: [{ rowName: 'A', seatNumber: 1, seatType: 'REGULAR' }, { rowName: 'A', seatNumber: 2, seatType: 'PREMIUM' }] };
const prices = [{ seatType: 'REGULAR', pricePaise: 20000 }, { seatType: 'PREMIUM', pricePaise: 35000 }];
function setup(role: 'ADMIN' | 'USER' | null = 'ADMIN', tokenRole: 'ADMIN' | 'USER' = 'ADMIN') {
  const id = randomUUID();
  const tokens = new TokenService({ secret, expiresInSeconds: 3600 });
  const service = new AuthService({ create: async () => { throw new Error('unused'); }, findByEmail: async () => null,
    findById: async () => role ? ({ id, role, name: 'Admin', email: 'admin@example.com', createdAt: new Date(), updatedAt: new Date() }) : null }, tokens);
  const catalog = testCatalog();
  const shows = testShows(catalog);
  const app = createApp({ frontendOrigin: 'http://localhost:5173', auth: { service, tokens }, catalog: catalog.services, shows: shows.services,
    healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }) });
  return { app, catalog, shows, id, token: tokens.sign({ userId: id, role: tokenRole }) };
}

type Fixture = ReturnType<typeof setup>;
const post = (f: Fixture, path: string, body: object) => request(f.app).post(path).set('Authorization', `Bearer ${f.token}`).send(body);
async function venue(f: Fixture, name = 'Mumbai', capacity = 2) {
  const city = await post(f, '/api/admin/cities', { name, state: 'Maharashtra' });
  expect(city.status).toBe(201);
  const theatre = await post(f, '/api/admin/theatres', { name: 'PVR', address: 'Main road', cityId: city.body.data.city.id });
  expect(theatre.status).toBe(201);
  const screen = await post(f, '/api/admin/screens', { name: 'Screen 1', capacity, theatreId: theatre.body.data.theatre.id });
  expect(screen.status).toBe(201);
  return { cityId: city.body.data.city.id as string, theatreId: theatre.body.data.theatre.id as string, screenId: screen.body.data.screen.id as string };
}
async function movie(f: Fixture, title = 'Interstellar') {
  const response = await post(f, '/api/admin/movies', { title, description: 'Space exploration', durationMinutes: 169,
    releaseDate: '2014-11-07', language: 'English', genres: ['Sci-Fi'], posterUrl: null });
  expect(response.status).toBe(201);
  return response.body.data.movie.id as string;
}
async function ready(f: Fixture) {
  const ids = await venue(f);
  const movieId = await movie(f);
  expect((await post(f, `/api/admin/screens/${ids.screenId}/seats`, layout)).status).toBe(201);
  return { ...ids, movieId };
}
const showInput = (movieId: string, screenId: string, startsAt = '2099-11-07T20:00:00+05:30') => ({ movieId, screenId, startsAt, prices });
function safeError(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.body.success).toBe(false);
  expect(Object.keys(response.body.error).sort()).toEqual(['code', 'message', 'requestId']);
  expect(response.body.error.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(response.headers['x-request-id']).toBe(response.body.error.requestId);
}

describe('screen seat layouts', () => {
  it('creates a complete physical layout for a screen', async () => {
    const { app, token } = setup();
    const send = (path: string, body: object) => request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
    const city = await send('/api/admin/cities', { name: 'Mumbai', state: 'Maharashtra' });
    expect(city.status).toBe(201);
    const theatre = await send('/api/admin/theatres', { name: 'PVR', address: 'Main road', cityId: city.body.data.city.id });
    expect(theatre.status).toBe(201);
    const screen = await send('/api/admin/screens', { name: 'Screen 1', capacity: 2, theatreId: theatre.body.data.theatre.id });
    expect(screen.status).toBe(201);
    const response = await send(`/api/admin/screens/${screen.body.data.screen.id}/seats`, {
      seats: [{ rowName: 'A', seatNumber: 1, seatType: 'REGULAR' }, { rowName: 'A', seatNumber: 2, seatType: 'PREMIUM' }],
    });
    expect(response.status).toBe(201);
  });
  it('normalizes rows and exposes physical seats without booking availability', async () => {
    const f = setup(); const ids = await venue(f);
    expect((await post(f, `/api/admin/screens/${ids.screenId}/seats`, { seats: [{ rowName: 'a', seatNumber: 1, seatType: 'REGULAR' }, layout.seats[1]] })).status).toBe(201);
    const response = await request(f.app).get(`/api/screens/${ids.screenId}/seats`);
    expect(response.status).toBe(200);
    expect(response.body.data.seats).toHaveLength(2);
    expect(response.body.data.seats[0]).toMatchObject({ screenId: ids.screenId, rowName: 'A', seatNumber: 1, seatType: 'REGULAR' });
    for (const seat of response.body.data.seats) {
      expect(seat).not.toHaveProperty('status'); expect(seat).not.toHaveProperty('isAvailable'); expect(seat).not.toHaveProperty('pricePaise');
    }
    expect((await post(f, `/api/admin/screens/${ids.screenId}/seats`, layout)).status).toBe(409);
  });
  it('rejects incomplete and oversized layouts without persisting partial seats', async () => {
    const f = setup(); const { screenId } = await venue(f);
    for (const seats of [[layout.seats[0]], [...layout.seats, { rowName: 'B', seatNumber: 1, seatType: 'REGULAR' }]]) {
      expect((await post(f, `/api/admin/screens/${screenId}/seats`, { seats })).status).toBe(400);
      expect((await request(f.app).get(`/api/screens/${screenId}/seats`)).body.data.seats).toEqual([]);
    }
  });
  it.each([
    { seats: [] }, { seats: [layout.seats[0], { ...layout.seats[0], rowName: 'a' }] },
    { seats: [{ ...layout.seats[0], seatNumber: 0 }, layout.seats[1]] },
    { seats: [{ ...layout.seats[0], rowName: '' }, layout.seats[1]] },
    { seats: [{ ...layout.seats[0], seatType: 'VIP' }, layout.seats[1]] },
    { seats: [{ ...layout.seats[0], status: 'AVAILABLE' }, layout.seats[1]] },
    { ...layout, isActive: true },
  ])('returns safe 400 for invalid seat layout', async body => {
    const f = setup(); const { screenId } = await venue(f);
    const response = await post(f, `/api/admin/screens/${screenId}/seats`, body);
    safeError(response, 400);
  });
});

describe('show admin access', () => {
  const paths = ['/api/admin/shows', `/api/admin/screens/${randomUUID()}/seats`];
  it.each(paths)('requires valid authentication and current admin role for %s', async path => {
    expect((await request(setup().app).post(path).send({})).status).toBe(401);
    expect((await post(setup('USER'), path, {})).status).toBe(403);
    expect((await post(setup(null), path, {})).status).toBe(401);
    const f = setup();
    const expired = jwt.sign({ userId: f.id, role: 'ADMIN' }, secret, { expiresIn: -1, issuer: 'cinehook', audience: 'cinehook-api' });
    expect((await request(f.app).post(path).set('Authorization', `Bearer ${expired}`).send({})).status).toBe(401);
  });
  it('accepts an admin whose token still carries the old USER claim', async () => {
    const f = setup('ADMIN', 'USER'); const { screenId } = await venue(f);
    expect((await post(f, `/api/admin/screens/${screenId}/seats`, layout)).status).toBe(201);
  });
});

describe('shows', () => {
  it('creates a UTC show snapshot and exposes nested detail and priced seats publicly', async () => {
    const f = setup(); const ids = await ready(f);
    const response = await post(f, '/api/admin/shows', showInput(ids.movieId, ids.screenId));
    expect(response.status).toBe(201);
    const id = response.body.data.show.id;
    const detail = await request(f.app).get(`/api/shows/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.show).toMatchObject({ movieId: ids.movieId, screenId: ids.screenId, status: 'SCHEDULED',
      startsAt: '2099-11-07T14:30:00.000Z', endsAt: '2099-11-07T17:19:00.000Z',
      movie: { id: ids.movieId }, screen: { id: ids.screenId, theatre: { id: ids.theatreId, city: { id: ids.cityId } } } });
    expect(detail.body.data.show.prices).toEqual(expect.arrayContaining(prices.map(p => expect.objectContaining(p))));
    const seats = await request(f.app).get(`/api/shows/${id}/seats`);
    expect(seats.status).toBe(200); expect(seats.body.data.showId).toBe(id);
    expect(seats.body.data.seats).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowName: 'A', seatNumber: 1, seatType: 'REGULAR', pricePaise: 20000 }),
      expect.objectContaining({ rowName: 'A', seatNumber: 2, seatType: 'PREMIUM', pricePaise: 35000 }),
    ]));
    for (const seat of seats.body.data.seats) {
      expect(Object.keys(seat).sort()).toEqual(['id', 'pricePaise', 'rowName', 'screenId', 'seatNumber', 'seatType']);
    }
    await request(f.app).patch(`/api/admin/movies/${ids.movieId}`).set('Authorization', `Bearer ${f.token}`).send({ durationMinutes: 10 });
    expect((await request(f.app).get(`/api/shows/${id}`)).body.data.show.endsAt).toBe('2099-11-07T17:19:00.000Z');
  });
  it.each([
    { startsAt: '2096-02-29T23:30:00-02:00', utc: '2096-03-01T01:30:00.000Z', end: '2096-03-01T04:19:00.000Z' },
    { startsAt: '2096-02-29T12:00:00+14:00', utc: '2096-02-28T22:00:00.000Z', end: '2096-02-29T00:49:00.000Z' },
  ])('accepts valid leap days and normalizes timezone offsets: $startsAt', async ({ startsAt, utc, end }) => {
    const f = setup(); const ids = await ready(f);
    const response = await post(f, '/api/admin/shows', showInput(ids.movieId, ids.screenId, startsAt));
    expect(response.status).toBe(201);
    expect(response.body.data.show).toMatchObject({ startsAt: utc, endsAt: end });
    const date = utc.slice(0, 10);
    const matchingDay = await request(f.app).get(`/api/shows?date=${date}`);
    expect(matchingDay.body.data.items.map((show: { id: string }) => show.id)).toEqual([response.body.data.show.id]);
  });
  it('requires a complete layout before scheduling', async () => {
    const f = setup(); const ids = await venue(f); const movieId = await movie(f);
    expect((await post(f, '/api/admin/shows', showInput(movieId, ids.screenId))).status).toBe(409);
  });
  it('rejects screen overlap while permitting exact end-time adjacency', async () => {
    const f = setup(); const ids = await ready(f);
    const first = await post(f, '/api/admin/shows', showInput(ids.movieId, ids.screenId, '2099-11-07T10:00:00Z'));
    expect(first.status).toBe(201);
    expect((await post(f, '/api/admin/shows', showInput(ids.movieId, ids.screenId, '2099-11-07T12:48:59Z'))).status).toBe(409);
    expect((await post(f, '/api/admin/shows', showInput(ids.movieId, ids.screenId, '2099-11-07T12:49:00Z'))).status).toBe(201);
  });
  it('hides cancelled shows and excludes past shows from the upcoming list', async () => {
    const f = setup(); const ids = await ready(f);
    const past = await post(f, '/api/admin/shows', showInput(ids.movieId, ids.screenId, '2029-11-07T10:00:00Z'));
    const cancelled = await post(f, '/api/admin/shows', showInput(ids.movieId, ids.screenId, '2099-11-07T10:00:00Z'));
    expect(past.status).toBe(201); expect(cancelled.status).toBe(201);
    const cancelledId = cancelled.body.data.show.id;
    f.shows.shows.get(cancelledId)!.status = 'CANCELLED';
    expect((await request(f.app).get('/api/shows')).body.data.items).toEqual([]);
    expect((await request(f.app).get(`/api/shows/${cancelledId}`)).status).toBe(404);
    expect((await request(f.app).get(`/api/shows/${cancelledId}/seats`)).status).toBe(404);
  });
  it.each([
    { startsAt: '2099-11-07T20:00:00' }, { startsAt: '2099-02-30T20:00:00Z' }, { startsAt: '0000-01-01T00:00:00Z' },
    { startsAt: '0001-01-01T00:00:00+14:00' },
    { startsAt: '2099-02-29T12:00:00Z' }, { startsAt: '2099-11-07T24:00:00Z' },
    { startsAt: '2099-11-07T12:00:00+14:01' }, { startsAt: '2099-11-07T12:00:00-14:01' },
    { startsAt: '2099-11-07T12:00:00+15:00' },
    { prices: [{ seatType: 'REGULAR', pricePaise: 20000 }] },
    { prices: [...prices, { seatType: 'REGULAR', pricePaise: 10000 }] },
    { prices: [...prices, { seatType: 'RECLINER', pricePaise: 50000 }] },
    { prices: [{ seatType: 'REGULAR', pricePaise: 0 }, prices[1]] },
    { prices: [{ seatType: 'REGULAR', pricePaise: 2.5 }, prices[1]] },
    { prices: [{ seatType: 'REGULAR', pricePaise: 2147483648 }, prices[1]] },
    { status: 'CANCELLED' }, { movieId: 'invalid' },
  ])('returns safe 400 for invalid show input', async override => {
    const f = setup(); const ids = await ready(f);
    const response = await post(f, '/api/admin/shows', { ...showInput(ids.movieId, ids.screenId), ...override });
    safeError(response, 400);
  });
  it('returns 404 for missing resources and disabled movies', async () => {
    const f = setup(); const ids = await ready(f);
    expect((await post(f, '/api/admin/shows', showInput(randomUUID(), ids.screenId))).status).toBe(404);
    expect((await post(f, '/api/admin/shows', showInput(ids.movieId, randomUUID()))).status).toBe(404);
    await request(f.app).delete(`/api/admin/movies/${ids.movieId}`).set('Authorization', `Bearer ${f.token}`);
    expect((await post(f, '/api/admin/shows', showInput(ids.movieId, ids.screenId))).status).toBe(404);
    for (const path of [`/api/shows/${randomUUID()}`, `/api/shows/${randomUUID()}/seats`, `/api/screens/${randomUUID()}/seats`]) {
      safeError(await request(f.app).get(path), 404);
    }
    expect((await post(f, `/api/admin/screens/${randomUUID()}/seats`, layout)).status).toBe(404);
  });
  it.each(['/api/shows/no', '/api/shows/no/seats', '/api/screens/no/seats', '/api/shows?page=0', '/api/shows?limit=101',
    '/api/shows?movieId=no', '/api/shows?cityId=no', '/api/shows?theatreId=no', '/api/shows?date=2099-02-30',
    '/api/shows?date=2099-11-07&date=2099-11-08', '/api/shows?unknown=x'])('rejects invalid public request %s', async path => {
    expect((await request(setup().app).get(path)).status).toBe(400);
  });
  it('filters upcoming shows and applies stable bounded pagination', async () => {
    const f = setup(); const ids = await ready(f);
    const first = await post(f, '/api/admin/shows', showInput(ids.movieId, ids.screenId, '2099-11-07T10:00:00Z'));
    const second = await post(f, '/api/admin/shows', showInput(ids.movieId, ids.screenId, '2099-11-07T20:00:00Z'));
    const third = await post(f, '/api/admin/shows', showInput(ids.movieId, ids.screenId, '2099-11-08T10:00:00Z'));
    for (const response of [first, second, third]) expect(response.status).toBe(201);
    const list = await request(f.app).get(`/api/shows?movieId=${ids.movieId}&cityId=${ids.cityId}&theatreId=${ids.theatreId}&date=2099-11-07&page=2&limit=1`);
    expect(list.status).toBe(200); expect(list.body.data).toMatchObject({ page: 2, limit: 1 });
    expect(list.body.data.items.map((show: { id: string }) => show.id)).toEqual([second.body.data.show.id]);
    for (const filter of ['movieId', 'cityId', 'theatreId']) expect((await request(f.app).get(`/api/shows?${filter}=${randomUUID()}`)).body.data.items).toEqual([]);
    await request(f.app).delete(`/api/admin/movies/${ids.movieId}`).set('Authorization', `Bearer ${f.token}`);
    expect((await request(f.app).get('/api/shows')).body.data.items).toEqual([]);
    expect((await request(f.app).get(`/api/shows/${first.body.data.show.id}`)).status).toBe(404);
    expect((await request(f.app).get(`/api/shows/${first.body.data.show.id}/seats`)).status).toBe(404);
  });
});
