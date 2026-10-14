import { describe, it, expect } from 'vitest';
import { importTmdbMovie } from '../prisma/dev-seed-tmdb-core.js';

const movieId = 'cce9a6b3-0e27-4a0f-ae42-9a9f5d5cd910';
const record = { id: movieId, title: 'Inception', language: 'english', releaseDate: new Date('2010-07-16'), ratingSource: null, ratingFetchedAt: null, ratingSourceUrl: null, posterUrl: '/demo-art/inception-poster.svg' };
const payload = { id: 27205, title: 'Inception', original_title: 'Inception', original_language: 'en', release_date: '2010-07-16', vote_average: 8.3, vote_count: 35000, poster_path: '/abc123.jpg', backdrop_path: '/def456.jpg' };
function fixture(response: unknown = payload) {
  const writes: unknown[] = [], requests: any[] = [];
  const store = { findById: async () => record, update: async (_id: string, data: unknown) => { writes.push(data); } };
  const request = async (url: any, options: any) => { requests.push({ url, options }); return new Response(JSON.stringify(response), { status: 200 }); };
  return { store, writes, requests, request };
}
const options = { nodeEnv: 'development', token: 'server-only-token', movieId, tmdbId: 27205, now: new Date('2026-10-09T10:00:00Z') };
describe('manual TMDB importer', () => {
  it('ratings-only import never replaces artwork, descriptions or trailers', async () => {
    const f = fixture();
    expect(await importTmdbMovie(f.store as never, { ...options, preserveMedia: true, includeTrailer: true } as never, f.request as never)).toEqual({ status: 'updated' });
    expect(f.writes).toEqual([{ ratingValue: 8.3, ratingVoteCount: 35000, ratingSource: 'TMDB', ratingSourceUrl: 'https://www.themoviedb.org/movie/27205', ratingFetchedAt: options.now }]);
    expect(f.requests).toHaveLength(1);
  });
  it('refuses production and missing credentials before any I/O', async () => {
    const f = fixture();
    await expect(importTmdbMovie(f.store as never, { ...options, token: undefined }, f.request as never)).resolves.toEqual({ status: 'unavailable' });
    await expect(importTmdbMovie(f.store as never, { ...options, nodeEnv: 'production' }, f.request as never)).rejects.toThrow(/development/i);
    expect(f.writes).toEqual([]); expect(f.requests).toEqual([]);
  });
  it('stores complete source-attributed verified data for only the explicitly selected matching film', async () => {
    const f = fixture();
    expect(await importTmdbMovie(f.store as never, options, f.request as never)).toEqual({ status: 'updated' });
    expect(f.writes[0]).toMatchObject({ posterUrl: 'https://image.tmdb.org/t/p/w500/abc123.jpg', ratingValue: 8.3, ratingVoteCount: 35000,
      ratingSource: 'TMDB', ratingSourceUrl: 'https://www.themoviedb.org/movie/27205', ratingFetchedAt: options.now,
      artworkKind: 'TMDB', artworkSourceUrl: 'https://www.themoviedb.org/movie/27205' });
    expect(f.requests[0].url).toBe('https://api.themoviedb.org/3/movie/27205');
    expect(f.requests[0].options.signal).toBeInstanceOf(AbortSignal);
    expect(f.requests[0].options.headers.Authorization).toBe('Bearer server-only-token');
  });
  it.each([{ ...payload, vote_average: 11 }, { ...payload, vote_count: 0 }, { ...payload, id: 1 }, { ...payload, title: 'Wrong movie', original_title: 'Wrong movie' }, { ...payload, original_language: 'hi' }, { ...payload, poster_path: '//evil.test/image.jpg' }])('preserves good metadata on invalid provider output', async data => {
    const f = fixture(data);
    expect(await importTmdbMovie(f.store as never, options, f.request as never)).toEqual({ status: 'unavailable' });
    expect(f.writes).toEqual([]);
  });
  it('preserves existing metadata after network failure', async () => {
    const f = fixture();
    expect(await importTmdbMovie(f.store as never, options, async () => { throw new Error('private provider error token'); })).toEqual({ status: 'unavailable' });
    expect(f.writes).toEqual([]);
  });
  it('uses a bounded seven-day rating cache instead of refetching a fresh matching record', async () => {
    const f = fixture();
    const store = { ...f.store, findById: async () => ({ ...record, ratingSource: 'TMDB', ratingSourceUrl: 'https://www.themoviedb.org/movie/27205', ratingFetchedAt: new Date('2026-10-08T10:00:00Z'), ratingValue: 8.3, ratingVoteCount: 35000 }) };
    expect(await importTmdbMovie(store as never, options, f.request as never)).toEqual({ status: 'cached' });
    expect(f.requests).toEqual([]);
    expect(await importTmdbMovie(store as never, { ...options, now: new Date('2026-10-16T10:00:00Z') }, f.request as never)).toEqual({ status: 'updated' });
  });
});
