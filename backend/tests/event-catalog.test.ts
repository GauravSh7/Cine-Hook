import { expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { HealthService } from '../src/modules/health/health.service.js';
import { testCatalog } from './helpers/catalog.js';

function setup(failing = false) {
  const queries: unknown[] = [];
  const tokens = new TokenService({ secret: 'event-catalog-test-only-12345678901234567890', expiresInSeconds: 3600 });
  const auth = new AuthService({ create: async () => { throw new Error('unused'); }, findByEmail: async () => null, findById: async () => null }, tokens);
  const events = {
    list: async (query: { page: number; limit: number }) => { queries.push(query); if (failing) throw new Error('private-connection'); return { items: [], page: query.page, limit: query.limit }; },
    getById: async (id: string) => ({ id, title: 'Persisted comedy' }),
    listSessions: async (query: { page: number; limit: number }) => { queries.push(query); return { items: [], page: query.page, limit: query.limit }; },
    getSessionById: async (id: string) => ({ id, prices: [{ ticketTier: 'STANDARD', pricePaise: 15000 }] }),
  };
  const dependencies = { frontendOrigin: 'http://localhost:5173', auth: { service: auth, tokens }, catalog: testCatalog().services,
    healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }), events };
  return { app: createApp(dependencies as Parameters<typeof createApp>[0]), queries };
}

it('registers both public catalog reads and preserves normalized bounded filters', async () => {
  const { app, queries } = setup();
  expect((await request(app).get('/api/events?kind=SPORTS&search=%20Sky%20&page=3&limit=6')).body).toEqual({ success: true, data: { items: [], page: 3, limit: 6 } });
  expect((await request(app).get('/api/event-sessions')).status).toBe(200);
  expect(queries).toEqual([{ kind: 'SPORTS', search: 'Sky', page: 3, limit: 6 }, { page: 1, limit: 20 }]);
});
it('exposes event and session detail envelopes with typed prices', async () => {
  const id = '65096d96-e27d-43af-baa3-bc3e06b1e2ea';
  const { app } = setup();
  expect((await request(app).get(`/api/events/${id}`)).body.data.event.title).toBe('Persisted comedy');
  expect((await request(app).get(`/api/event-sessions/${id}`)).body.data.session.prices).toEqual([{ ticketTier: 'STANDARD', pricePaise: 15000 }]);
});
it.each(['kind=STREAM', 'kind=events', 'page=0', 'limit=101', 'page=1&page=2', 'cityId=invalid', 'eventId=invalid', 'extra=1', 'search=a&search=b'])('rejects invalid catalog queries before reading: %s', async query => {
  const { app, queries } = setup();
  expect((await request(app).get(`/api/events?${query}`)).status).toBe(400);
  expect(queries).toEqual([]);
});
it('validates session filters and detail IDs and has no public inventory writes', async () => {
  const { app } = setup();
  expect((await request(app).get('/api/event-sessions?eventId=invalid')).status).toBe(400);
  expect((await request(app).get('/api/events/invalid')).status).toBe(400);
  for (const method of ['post', 'patch', 'delete'] as const) expect((await request(app)[method]('/api/events').send({})).status).toBe(404);
});
it('hides private errors behind the standard safe response', async () => {
  const response = await request(setup(true).app).get('/api/events');
  expect(response.status).toBe(500);
  expect(response.body.error.code).toBe('INTERNAL_ERROR');
  expect(JSON.stringify(response.body)).not.toContain('private-connection');
});
