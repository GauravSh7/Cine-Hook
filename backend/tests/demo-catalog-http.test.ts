import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { HealthService } from '../src/modules/health/health.service.js';
import { testCatalog } from './helpers/catalog.js';

function setup(unavailable = false) {
  const tokens = new TokenService({ secret: 'demo-catalog-test-only-12345678901234567890', expiresInSeconds: 3600 });
  const service = new AuthService({ create: async () => { throw new Error('unused'); }, findByEmail: async () => null, findById: async () => null }, tokens);
  const queries: unknown[] = [];
  const dependencies = { frontendOrigin: 'http://localhost:5173', auth: { service, tokens }, catalog: testCatalog().services,
    healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }),
    demoCatalog: { list: async (query: { page: number; limit: number }) => { queries.push(query); if (unavailable) throw new Error('private database error do-not-expose'); return { items: [], page: query.page, limit: query.limit }; }, get: async () => { throw new Error('unused'); } } };
  return { app: createApp(dependencies), queries };
}

describe('read-only demo catalogue HTTP contract', () => {
  it('publicly lists each supported kind with default pagination and no login', async () => {
    const { app, queries } = setup();
    for (const kind of ['stream', 'events', 'sports', 'activities']) {
      const response = await request(app).get(`/api/demo-catalog/${kind}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, data: { items: [], page: 1, limit: 20 } });
    }
    expect(queries).toEqual(['STREAM', 'EVENTS', 'SPORTS', 'ACTIVITIES'].map(kind => ({ kind, page: 1, limit: 20 })));
  });
  it('trims filters, maps the route kind and preserves bounded pagination', async () => {
    const { app, queries } = setup();
    expect((await request(app).get('/api/demo-catalog/events?category=%20Concerts%20&search=%20Sky%20&page=3&limit=6')).status).toBe(200);
    expect(queries).toEqual([{ kind: 'EVENTS', category: 'Concerts', search: 'Sky', page: 3, limit: 6 }]);
  });
  it.each(['films', 'EVENTS', ''])('rejects unknown or incorrectly cased kinds: %s', async kind => {
    expect((await request(setup().app).get(`/api/demo-catalog/${kind}`)).status).toBe(kind ? 400 : 404);
  });
  it.each(['page=0', 'page=1.5', 'page=100001', 'page=', 'page=true', 'page=1&page=2', 'limit=0', 'limit=101', 'search[x]=bad', 'category=a&category=b', 'extra=bad', `search=${'x'.repeat(101)}`])('rejects malformed query %s before reading', async query => {
    const { app, queries } = setup();
    const response = await request(app).get(`/api/demo-catalog/events?${query}`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(queries).toEqual([]);
  });
  it('has no create, update or delete endpoint', async () => {
    const { app } = setup();
    for (const method of ['post', 'patch', 'delete'] as const) expect((await request(app)[method]('/api/demo-catalog/events').send({ title: 'real event' })).status).toBe(404);
  });
  it('returns the standard safe error when the catalogue store is unavailable', async () => {
    const { app } = setup(true);
    const response = await request(app).get('/api/demo-catalog/events');
    expect(response.status).toBe(500);
    expect(response.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
    expect(JSON.stringify(response.body)).not.toContain('do-not-expose');
  });
  it('treats empty optional filters as no filter', async () => {
    const { app, queries } = setup();
    expect((await request(app).get('/api/demo-catalog/events?category=&search=')).status).toBe(200);
    expect(queries).toEqual([{ kind: 'EVENTS', page: 1, limit: 20 }]);
  });
});
