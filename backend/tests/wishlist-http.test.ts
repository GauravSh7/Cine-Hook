import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import request from 'supertest';
import { accountFixture } from './helpers/account-wishlist.js';
async function fixture() {
  const f = accountFixture(); const movie = await f.catalog.services.movies.create({ title: 'Arrival', description: 'Science fiction', durationMinutes: 116,
    releaseDate: new Date('2016-11-11'), language: 'english', genres: ['sci-fi'], posterUrl: null });
  return { ...f, movie, url: `/api/wishlist/movies/${movie.id}` };
}
it('saves idempotently and isolates owners across list/status/delete', async () => {
  const f = await fixture(); const owner = f.authorization(); const other = f.authorization(f.other.id);
  const initial = await request(f.app).get(f.url).set('Authorization', owner); expect(initial.body.data).toEqual({ saved: false });
  for (let i = 0; i < 2; i++) expect((await request(f.app).put(f.url).set('Authorization', owner).send({})).body.data).toEqual({ saved: true });
  expect(f.rows.size).toBe(1);
  const list = await request(f.app).get('/api/wishlist/movies').set('Authorization', owner);
  expect(list.body.data).toMatchObject({ page: 1, limit: 20, items: [{ movie: { id: f.movie.id, title: 'Arrival', isActive: true } }] });
  expect(Object.keys(list.body.data.items[0]).sort()).toEqual(['createdAt', 'movie']); expect(list.headers['cache-control']).toBe('no-store');
  expect((await request(f.app).get(f.url).set('Authorization', other)).body.data).toEqual({ saved: false });
  expect((await request(f.app).get('/api/wishlist/movies').set('Authorization', other)).body.data.items).toEqual([]);
  expect((await request(f.app).delete(f.url).set('Authorization', other)).body.data).toEqual({ saved: false });
  expect((await request(f.app).get(f.url).set('Authorization', owner)).body.data).toEqual({ saved: true });
  for (let i = 0; i < 2; i++) expect((await request(f.app).delete(f.url).set('Authorization', owner)).body.data).toEqual({ saved: false });
  expect(f.rows.size).toBe(0);
});
it('keeps disabled saved movies visible and removable but prevents new saves', async () => {
  const f = await fixture();
  await request(f.app).put(f.url).set('Authorization', f.authorization()).send({});
  await f.catalog.services.movies.disable(f.movie.id);
  const list = await request(f.app).get('/api/wishlist/movies').set('Authorization', f.authorization());
  expect(list.body.data.items[0].movie.isActive).toBe(false);
  expect((await request(f.app).put(f.url).set('Authorization', f.authorization(f.other.id)).send({})).status).toBe(404);
  expect((await request(f.app).delete(f.url).set('Authorization', f.authorization())).body.data.saved).toBe(false);
});
it('rejects missing movies and malformed IDs without adding entries', async () => {
  const f = await fixture();
  expect((await request(f.app).put(`/api/wishlist/movies/${randomUUID()}`).set('Authorization', f.authorization()).send({})).status).toBe(404);
  expect((await request(f.app).put('/api/wishlist/movies/not-uuid').set('Authorization', f.authorization()).send({})).status).toBe(400);
  expect(f.rows.size).toBe(0);
});
it.each([{ userId: 'other' }, { movie: { title: 'injected' } }, { createdAt: '2000-01-01' }, [], 'bad'])('rejects wishlist owner and metadata injection %j', async body => {
  const f = await fixture();
  const result = await request(f.app).put(f.url).set('Authorization', f.authorization()).send(body);
  expect(result.status).toBe(400); expect(f.rows.size).toBe(0);
});
it('rejects owner query parameters even on status reads', async () => {
  const f = await fixture();
  const result = await request(f.app).get(f.url).query({ userId: f.other.id }).set('Authorization', f.authorization());
  expect(result.status).toBe(400);
});
it.each([{ page: 0 }, { limit: 101 }, { limit: 0 }, { page: 'x' }, { userId: 'other' }])('rejects invalid pagination/query %j', async query => {
  const f = await fixture(); expect((await request(f.app).get('/api/wishlist/movies').query(query).set('Authorization', f.authorization())).status).toBe(400);
});
it('uses pagination without exposing internal movie or owner fields', async () => {
  const f = await fixture();
  Object.assign(f.movie, { privateData: 'internal-only' });
  await request(f.app).put(f.url).set('Authorization', f.authorization()).send({});
  const list = await request(f.app).get('/api/wishlist/movies?page=1&limit=1').set('Authorization', f.authorization());
  expect(list.body.data).toMatchObject({ page: 1, limit: 1 }); expect(list.body.data.items).toHaveLength(1);
  expect(list.body.data.items[0].movie).not.toHaveProperty('privateData');
  const second = await request(f.app).get('/api/wishlist/movies?page=2&limit=1').set('Authorization', f.authorization());
  expect(second.body.data.items).toEqual([]);
});
