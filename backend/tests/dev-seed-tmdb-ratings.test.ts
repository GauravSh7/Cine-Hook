import { describe, it, expect } from 'vitest';
import { matchesTmdbMovie } from '../prisma/dev-seed-tmdb-core.js';

const film = { title: 'Salaar: Part 1 – Ceasefire', language: 'telugu', releaseDate: new Date('2023-12-22') };
const candidate = { title: 'Salaar: Part I - Ceasefire', original_title: 'సలార్: పార్ట్ 1 – సీజ్‌ఫైర్', original_language: 'te', release_date: '2023-12-21' };
describe('conservative TMDB matching', () => {
  it.each([
    ['Baahubali 2: The Conclusion', 'Bāhubali 2: The Conclusion', 'telugu', 'te', '2017-04-27'],
    ['Lagaan', 'Lagaan: Once Upon a Time in India', 'hindi', 'hi', '2001-06-15'],
  ])('accepts verified alternate provider title for %s', (title, providerTitle, language, originalLanguage, releaseDate) => {
    expect(matchesTmdbMovie({ title, language, releaseDate: new Date(releaseDate) }, { ...candidate, title: providerTitle, original_language: originalLanguage, release_date: releaseDate })).toBe(true);
  });
  it('accepts explicit alternate titles and punctuation only with the same language and release year', () => {
    expect(matchesTmdbMovie(film, candidate)).toBe(true);
    expect(matchesTmdbMovie(film, { ...candidate, original_language: 'hi' })).toBe(false);
    expect(matchesTmdbMovie(film, { ...candidate, release_date: '2024-12-22' })).toBe(false);
    expect(matchesTmdbMovie(film, { ...candidate, title: 'Salaar Part 2' })).toBe(false);
  });
  it('allows the known Stree 2 subtitle but does not accept arbitrary extended titles', () => {
    const stree = { title: 'Stree 2', language: 'hindi', releaseDate: new Date('2024-08-15') };
    expect(matchesTmdbMovie(stree, { ...candidate, title: 'Stree 2: Sarkate Ka Aatank', original_language: 'hi', release_date: '2024-08-15' })).toBe(true);
    expect(matchesTmdbMovie(stree, { ...candidate, title: 'Stree 2: unrelated film', original_language: 'hi', release_date: '2024-08-15' })).toBe(false);
  });
  it('matches exact original titles and treats punctuation consistently', () => {
    expect(matchesTmdbMovie({ ...film, title: 'K.G.F: Chapter 2', language: 'kannada', releaseDate: new Date('2022-04-14') }, { ...candidate, title: 'KGF Chapter 2', original_language: 'kn', release_date: '2022-04-14' })).toBe(true);
    expect(matchesTmdbMovie({ ...film, title: 'Inception', language: 'english', releaseDate: new Date('2010-07-16') }, { ...candidate, title: 'Translated', original_title: 'Inception', original_language: 'en', release_date: '2010-07-16' })).toBe(true);
  });
});
