import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { z } from 'zod';
import { resolveDevTarget, verifyDatabaseIdentity } from '../scripts/dev-target.js';
import { importTmdbMovie, matchesTmdbMovie } from './dev-seed-tmdb-core.js';
import { FILMS, seedId } from './dev-seed-manifest.js';
import { publicMovie } from '../src/modules/catalog/public-movie.js';

const searchSchema = z.object({ results: z.array(z.object({ id: z.number().int().positive(), title: z.string().max(200), original_title: z.string().max(200), original_language: z.string().max(10), release_date: z.string().max(10) })).max(100) });
async function search(title: string, year: string, token: string) {
  try {
    const url = new URL('https://api.themoviedb.org/3/search/movie');
    url.search = new URLSearchParams({ query: title, year, include_adult: 'false', language: 'en-US' }).toString();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 1024 * 1024) return [];
    const body = await response.text();
    if (body.length > 1024 * 1024) return [];
    const parsed = searchSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data.results : [];
  } catch { return []; }
}

async function main() {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  const target = resolveDevTarget(process.env);
  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  if (!token) throw new Error('Missing provider configuration.');
  const pool = new pg.Pool({ connectionString: target.url, max: 1, connectionTimeoutMillis: 2000 });
  try { await verifyDatabaseIdentity(pool, target); } finally { await pool.end(); }
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([import('../src/generated/prisma/client.js'), import('@prisma/adapter-pg')]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, connectionTimeoutMillis: 2000 }) });
  try {
    const rows = await prisma.movie.findMany({ where: { id: { in: FILMS.map(film => seedId(`movie:${film.key}`)) } }, orderBy: { title: 'asc' } });
    if (rows.length !== 30 || FILMS.length !== 30) throw new Error('Expected exactly thirty existing development movies.');
    for (const row of rows) {
      const film = FILMS.find(film => seedId(`movie:${film.key}`) === row.id)!;
      if (row.title !== film.title || row.language !== film.language || row.releaseDate.toISOString().slice(0, 10) !== film.releaseDate) throw new Error('Development movie identity changed.');
    }
    // All fields except ratings and the automatic update timestamp must remain byte-for-byte equivalent.
    const fingerprint = (movies: typeof rows) => createHash('sha256').update(JSON.stringify(movies.map(({ ratingValue, ratingVoteCount, ratingSource, ratingSourceUrl, ratingFetchedAt, updatedAt, ...rest }) => rest))).digest('hex');
    const before = fingerprint(rows);
    const counts = { updated: 0, cached: 0, unavailable: 0, ambiguous: 0 };
    const skipped: string[] = [];
    for (const row of rows) {
      if (publicMovie(row).rating) { counts.cached++; continue; }
      const results = await search(row.title, row.releaseDate.toISOString().slice(0, 4), token);
      const matches = results.filter(candidate => matchesTmdbMovie(row, candidate));
      const unique = [...new Map(matches.map(candidate => [candidate.id, candidate])).values()];
      if (unique.length !== 1) { counts[unique.length > 1 ? 'ambiguous' : 'unavailable']++; skipped.push(row.title); continue; }
      const result = await importTmdbMovie({ findById: id => prisma.movie.findUnique({ where: { id } }), update: (id, data) => prisma.movie.update({ where: { id }, data }) }, {
        nodeEnv: 'development', token, movieId: row.id, tmdbId: unique[0]!.id, preserveMedia: true,
      });
      counts[result.status]++;
      if (result.status === 'unavailable') skipped.push(row.title);
    }
    const after = await prisma.movie.findMany({ where: { id: { in: rows.map(row => row.id) } }, orderBy: { title: 'asc' } });
    if (before !== fingerprint(after)) throw new Error('Movie preservation verification failed.');
    console.log(JSON.stringify({ database: target.database, existingMovies: rows.length, ...counts, verifiedRatings: after.filter(row => publicMovie(row).rating).length, preservedNonRatingFields: true, skippedTitles: skipped }));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('Ratings import stopped safely. Check the guarded development target and provider configuration.'); process.exitCode = 1; });
