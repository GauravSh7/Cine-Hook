import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { resolveDevTarget, verifyDatabaseIdentity } from '../scripts/dev-target.js';
import { curatedHindiSummary, verifiedHindiOverview } from './dev-tmdb-hindi-core.js';
import { FILMS } from './dev-seed-manifest.js';
import { HINDI_SUMMARIES } from './refinement-manifest.js';

type Candidate = { id: string; title: string; metadataSourceUrl: string | null };

async function fetchHindiOverview(movieId: number, token: string): Promise<string | null> {
  try {
    const url = new URL(`https://api.themoviedb.org/3/movie/${movieId}`);
    url.searchParams.set('language', 'hi-IN');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 1024 * 1024) return null;
    const body = await response.text();
    if (body.length > 1024 * 1024) return null;
    return verifiedHindiOverview(movieId, JSON.parse(body));
  } catch { return null; }
}

async function main() {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  if (process.env.NODE_ENV !== 'development') throw new Error('Hindi metadata updates require development mode.');
  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  if (!token) throw new Error('TMDB provider configuration is required.');
  const target = resolveDevTarget(process.env);
  const pool = new pg.Pool({ connectionString: target.url, max: 1, connectionTimeoutMillis: 2000 });
  try { await verifyDatabaseIdentity(pool, target); } finally { await pool.end(); }
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([import('../src/generated/prisma/client.js'), import('@prisma/adapter-pg')]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, options: '-c timezone=UTC', connectionTimeoutMillis: 2000 }) });
  try {
    if (target.database !== 'cinehook_dev' || target.port !== 5432) throw new Error('Development database identity mismatch.');
    let curatedEnriched = 0;
    for (const film of FILMS) {
      const summary = HINDI_SUMMARIES[film.key];
      if (!summary) continue;
      const releaseDate = new Date(`${film.releaseDate}T00:00:00Z`);
      const matches = await prisma.movie.findMany({
        where: { title: film.title, language: film.language, releaseDate },
        select: { id: true }, take: 2,
      });
      if (matches.length !== 1) continue;
      const result = await prisma.movie.updateMany({
        where: { id: matches[0]!.id, title: film.title, language: film.language, releaseDate,
          OR: [{ descriptionHindi: null }, { descriptionHindi: '' }] },
        data: { descriptionHindi: summary },
      });
      curatedEnriched += result.count;
    }
    const rows = await prisma.movie.findMany({ where: { isActive: true, OR: [{ descriptionHindi: null }, { descriptionHindi: '' }], metadataSourceUrl: { startsWith: 'https://www.themoviedb.org/movie/' } },
      select: { id: true, title: true, metadataSourceUrl: true }, orderBy: [{ title: 'asc' }, { id: 'asc' }] });
    let enriched = 0, curatedEnrichedByTmdbId = 0, noHindiTranslation = 0, invalidSource = 0;
    for (let offset = 0; offset < rows.length; offset += 8) {
      const batch = rows.slice(offset, offset + 8);
      const resolved = await Promise.all(batch.map(async (movie: Candidate) => {
        const match = movie.metadataSourceUrl?.match(/^https:\/\/www\.themoviedb\.org\/movie\/([1-9]\d*)$/);
        if (!match) return { movie, tmdbId: null, overview: null, invalid: true };
        return { movie, tmdbId: Number(match[1]), overview: await fetchHindiOverview(Number(match[1]), token), invalid: false };
      }));
      for (const entry of resolved) {
        if (entry.invalid) { invalidSource++; continue; }
        const summary = entry.overview ?? (entry.tmdbId ? curatedHindiSummary(entry.tmdbId, entry.movie.metadataSourceUrl) : null);
        if (!summary) { noHindiTranslation++; continue; }
        const update = await prisma.movie.updateMany({ where: { id: entry.movie.id, OR: [{ descriptionHindi: null }, { descriptionHindi: '' }] }, data: { descriptionHindi: summary } });
        if (entry.overview) enriched += update.count;
        else curatedEnrichedByTmdbId += update.count;
      }
    }
    console.log(JSON.stringify({ database: target.database, checked: rows.length, curatedEnriched, tmdbEnriched: enriched, curatedEnrichedByTmdbId, noHindiTranslation, invalidSource, changedOnlyHindiOverview: true }));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('Hindi metadata update stopped safely. Verify the development database and TMDB setup.'); process.exitCode = 1; });
