import { describe, expect, it } from 'vitest';
import { publicMovie } from '../src/modules/catalog/public-movie.js';
import { importTmdbMovie } from '../prisma/dev-seed-tmdb-core.js';
const now = new Date('2026-10-10T00:00:00Z');
const record = { id: '10000000-0000-4000-8000-000000000001', title: 'Inception', description: 'A team enters dreams.',
  descriptionHindi: 'एक दल सपनों की दुनिया में प्रवेश करता है।', durationMinutes: 148, releaseDate: new Date('2010-07-16'), language: 'english',
  genres: ['sci-fi'], isActive: true, ratingSource: null, ratingSourceUrl: null, ratingFetchedAt: null, trailerVideoId: 'testOnlyID1',
  trailerSourceUrl: 'https://www.themoviedb.org/movie/27205', trailerVerifiedAt: now, createdAt: now, updatedAt: now };
describe('trusted movie media projection', () => {
  it('exposes persisted Hindi alongside the original English description', () => {
    expect(publicMovie(record as never, undefined, now)).toMatchObject({ descriptionHindi: 'एक दल सपनों की दुनिया में प्रवेश करता है।', description: 'A team enters dreams.' });
  });
  it('exposes the earliest upcoming show time for catalogue cards', () => {
    const next = new Date('2026-10-12T13:00:00Z');
    expect(publicMovie({ ...record, shows: [{ id: 'show-1', startsAt: next }] } as never, undefined, now).bookingAvailability)
      .toEqual({ cityId: null, hasShows: true, nextShowStartsAt: next });
  });
  it('derives embeds only from a strict ID and verified TMDB provenance', () => {
    const result = publicMovie({ ...record, trailerVideoId: 'TestOnlyID1' } as never, undefined, now);
    expect(result).toMatchObject({ trailer: { videoId: 'TestOnlyID1', provider: 'YouTube', sourceUrl: record.trailerSourceUrl } });
  });
  it.each([{ trailerVideoId: '../evil' }, { trailerSourceUrl: 'https://evil.test/movie/27205' }, { trailerVerifiedAt: null }, { trailerVerifiedAt: new Date('2099-01-01') }])('suppresses invalid or unverified trailer data %s', bad => {
    expect(publicMovie({ ...record, ...bad } as never, undefined, now)).toMatchObject({ trailer: null });
  });
});
describe('official trailer importer', () => {
  const payload = { id: 27205, title: 'Inception', original_title: 'Inception', original_language: 'en', release_date: '2010-07-16',
    vote_average: 8.3, vote_count: 35000, poster_path: '/abc123.jpg', backdrop_path: '/def456.jpg' };
  const official = { key: 'TestOnlyID1', site: 'YouTube', official: true, type: 'Trailer' };
  async function run(videos: unknown) {
    let write: any; const urls: string[] = [];
    const store = { findById: async () => record, update: async (_id: string, data: unknown) => { write = data; } };
    await importTmdbMovie(store as never, { nodeEnv: 'development', token: 'test-only-never-live', movieId: record.id, tmdbId: 27205, now, includeTrailer: true }, async input => {
      urls.push(String(input)); return new Response(JSON.stringify(String(input).endsWith('/videos') ? { id: 27205, results: videos } : payload));
    }); return { write, urls };
  }
  it('stores an official YouTube Trailer only after exact movie identity verification', async () => {
    const result = await run([official]);
    expect(result.write).toMatchObject({ trailerVideoId: 'TestOnlyID1', trailerSourceUrl: record.trailerSourceUrl, trailerVerifiedAt: now });
  });
  it.each([[{ ...official, official: false }], [{ ...official, site: 'Other' }], [{ ...official, key: '//evil.test' }], [{ ...official, type: 'Clip' }]])('does not persist an unapproved video %s', async videos => {
    expect((await run(videos)).write).not.toHaveProperty('trailerVideoId');
  });
});
