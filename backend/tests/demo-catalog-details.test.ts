import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { DemoCatalogService } from '../src/modules/demo-catalog/demo-catalog.service.js';
import { testCatalog } from './helpers/catalog.js';

const id = '60000000-0000-4000-8000-000000000001';
const cityId = '60000000-0000-4000-8000-000000000002';
const entry = { id, slug: 'sample-comedy', kind: 'EVENTS' as const, title: 'Laugh Lines — DEMO', description: 'Fictional comedy showcase.',
  category: 'Comedy Shows', cityName: 'New Delhi', venueName: 'Sample Studio', startsAt: new Date('2099-10-12T14:00:00Z'),
  durationMinutes: 75, imageUrl: '/demo-category-art/events.svg', imageAttribution: 'Original CC0 illustration.',
  isActive: true, createdAt: new Date(), updatedAt: new Date() };
function setup(active = true) {
  const queries: unknown[] = [];
  const demo = new DemoCatalogService({
    list: async query => { queries.push(query); return [entry]; },
    findActive: async (kind, requested) => { queries.push({ kind, id: requested }); return active && kind === entry.kind && requested === id ? entry : null; },
    findCityName: async requested => requested === cityId ? 'New Delhi' : null,
  });
  const tokens = new TokenService({ secret: 'catalog-details-test-only-secret-1234567890', expiresInSeconds: 3600 });
  const auth = new AuthService({ create: async () => { throw Error('unused'); }, findByEmail: async () => null, findById: async () => null }, tokens);
  return { app: createApp({ frontendOrigin: 'http://localhost:5173', auth: { service: auth, tokens }, catalog: testCatalog().services, demoCatalog: demo }), demo, queries };
}
describe('scoped public category details and city reads', () => {
  it('opens a persisted active listing with non-bookable public data, not internal fields', async () => {
    const response = await request(setup().app).get(`/api/demo-catalog/events/${id}`);
    expect(response.status).toBe(200);
    expect(response.body.data.listing).toMatchObject({ id, title: entry.title, category: 'Comedy Shows', isDemo: true, bookingAvailable: false });
    expect(response.body.data.listing).not.toHaveProperty('isActive');
    expect(response.body.data.listing).not.toHaveProperty('createdAt');
  });
  it.each(['sports', 'activities', 'stream'])('does not leak an EVENTS listing through %s', async kind => {
    const response = await request(setup().app).get(`/api/demo-catalog/${kind}/${id}`);
    expect(response.status).toBe(404); expect(response.body.error.code).toBe('LISTING_NOT_FOUND');
  });
  it('does not return inactive or unknown listing records', async () => {
    expect((await request(setup(false).app).get(`/api/demo-catalog/events/${id}`)).status).toBe(404);
    expect((await request(setup().app).get('/api/demo-catalog/events/60000000-0000-4000-8000-000000000099')).status).toBe(404);
  });
  it.each(['not-a-uuid', '..', '1'])('rejects invalid listing identity %s before reading', async invalid => {
    const { app, queries } = setup();
    const response = await request(app).get(`/api/demo-catalog/events/${invalid}`);
    expect(response.status).toBe(400); expect(queries).toHaveLength(0);
  });
  it('uses only an existing city name resolved by the server for physical listings', async () => {
    const { app, queries } = setup();
    expect((await request(app).get(`/api/demo-catalog/events?cityId=${cityId}`)).status).toBe(200);
    expect(queries).toEqual([{ kind: 'EVENTS', page: 1, limit: 20, cityName: 'New Delhi' }]);
  });
  it('restores the existing category cards when the selected city has no local cards', async () => {
    const queries: unknown[] = [];
    const service = new DemoCatalogService({
      list: async query => { queries.push(query); return 'cityName' in query ? [] : [entry]; },
      findActive: async () => null,
      findCityName: async requested => requested === cityId ? 'Muzaffarnagar' : null,
    });
    const result = await service.list({ kind: 'EVENTS', cityId, page: 1, limit: 20 });
    expect(result.items.map(item => item.id)).toEqual([entry.id]);
    expect(queries).toEqual([
      { kind: 'EVENTS', page: 1, limit: 20, cityName: 'Muzaffarnagar' },
      { kind: 'EVENTS', page: 1, limit: 20 },
    ]);
  });
  it('rejects unsupported cities instead of making geographical coverage up', async () => {
    const { app, queries } = setup();
    const response = await request(app).get('/api/demo-catalog/sports?cityId=60000000-0000-4000-8000-000000000099');
    expect(response.status).toBe(404); expect(response.body.error.code).toBe('CITY_NOT_FOUND'); expect(queries).toHaveLength(0);
  });
  it('validates but does not filter cityless streaming concepts by a physical venue', async () => {
    const { demo, queries } = setup();
    await demo.list({ kind: 'STREAM', cityId, page: 1, limit: 20 });
    expect(queries).toEqual([{ kind: 'STREAM', page: 1, limit: 20 }]);
  });
  it.each(['cityId=invalid', `cityId=${cityId}&cityId=${cityId}`, 'cityName=Mumbai'])('rejects malformed or browser-resolved location %s', async query => {
    const { app, queries } = setup();
    expect((await request(app).get(`/api/demo-catalog/events?${query}`)).status).toBe(400); expect(queries).toHaveLength(0);
  });
  it('offers no mutation or booking action on a detail route', async () => {
    for (const method of ['post','patch','delete'] as const) expect((await request(setup().app)[method](`/api/demo-catalog/events/${id}`).send({ paid: true, amount: 1 })).status).toBe(404);
  });
});
