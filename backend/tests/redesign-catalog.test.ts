import { describe, it, expect, vi } from 'vitest';
import { movieCreateSchema, movieQuerySchema } from '../src/modules/catalog/catalog.validation.js';
import { showQuerySchema } from '../src/modules/shows/show.validation.js';
import { MovieRepository } from '../src/modules/catalog/movie.repository.js';
import { MovieService } from '../src/modules/catalog/movie.service.js';
import { FILMS } from '../prisma/dev-seed-manifest.js';

const input = { title: 'Example', description: 'Original description', durationMinutes: 120, releaseDate: '2024-01-01', language: 'english', genres: ['drama'] };
describe('redesign catalog contracts', () => {
  it('accepts only controlled native illustration paths and secure remote artwork', () => {
    expect(movieCreateSchema.safeParse({ ...input, posterUrl: '/demo-art/example-poster.svg' }).success).toBe(true);
    for (const posterUrl of ['/uploads/a.svg', '/demo-art/../secret.svg', '/demo-art/a.svg?x=1', '//evil.test/a.svg', 'http://evil.test/a'])
      expect(movieCreateSchema.safeParse({ ...input, posterUrl }).success).toBe(false);
  });
  it('accepts validated city context for movie reads', () => {
    expect(movieQuerySchema.safeParse({ cityId: 'd7236b04-405a-4ad5-972d-d749fc80aede' }).success).toBe(true);
    expect(movieQuerySchema.safeParse({ cityId: 'invalid' }).success).toBe(false);
  });
  it('accepts IST calendar days separately from UTC dates', () => {
    expect(showQuerySchema.safeParse({ localDate: '2026-10-09' }).success).toBe(true);
    expect(showQuerySchema.safeParse({ localDate: '2026-02-30' }).success).toBe(false);
    expect(showQuerySchema.safeParse({ date: '2026-10-09', localDate: '2026-10-09' }).success).toBe(false);
  });
  it('has 30 unique sourced films while preserving the first six identities', () => {
    expect(FILMS).toHaveLength(30);
    expect(new Set(FILMS.map(f => f.key)).size).toBe(30);
    expect(FILMS.slice(0,6).map(f => f.key)).toEqual(['deadpool-wolverine','inside-out-2','stree-2','kalki-2898-ad','salaar','devara']);
  });
  it('projects safe public movie data instead of exposing stored rating columns', async () => {
    const record = { ...input, id: 'movie', releaseDate: new Date('2024-01-01'), posterUrl: null, isActive: true, ratingValue: 8.5, ratingSource: null, ratingFetchedAt: null, ratingVoteCount: null };
    const service = new MovieService({ list: async () => [record], findById: async () => record } as never);
    const result = await service.list({ page: 1, limit: 20 });
    expect(result.items[0]).toMatchObject({ rating: null, bookingAvailability: { hasShows: false, cityId: null } });
    expect(result.items[0]).not.toHaveProperty('ratingValue');
  });
  it('derives bookability from scheduled future shows in the selected city', async () => {
    const findMany = vi.fn(async () => []);
    await new MovieRepository({ movie: { findMany } } as never).list({ page: 1, limit: 20, cityId: 'city' } as never);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ include: { shows: { where: { status: 'SCHEDULED', startsAt: { gt: expect.any(Date) }, screen: { theatre: { cityId: 'city' } } }, take: 1 } } });
  });
});
