import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { resolveDevTarget, verifyDatabaseIdentity } from '../scripts/dev-target.js';
import { seedId } from './dev-seed-manifest.js';

type UpcomingItem = { id: number; release_date: string };
type UpcomingResponse = { results: UpcomingItem[] };
type DiscoverResponse = { results: UpcomingItem[] };
type TmdbMovie = { id: number; title: string; original_title: string; original_language: string; release_date: string; runtime: number | null; overview: string; poster_path: string | null; backdrop_path: string | null; vote_average: number; vote_count: number; genres: { id: number; name: string }[] };
const LANGUAGES: Record<string, string> = { en: 'english', hi: 'hindi', te: 'telugu', ta: 'tamil', kn: 'kannada', ml: 'malayalam', bn: 'bengali', mr: 'marathi', pa: 'punjabi', gu: 'gujarati', ur: 'urdu', ja: 'japanese', ko: 'korean', zh: 'chinese', fr: 'french', es: 'spanish' };
const RECENT_LANGUAGES = ['en', 'hi', 'te', 'ta', 'kn', 'ml'] as const;
type RecentLanguage = (typeof RECENT_LANGUAGES)[number];

function todayInIndia(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
async function providerJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error(`Metadata provider returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length') ?? 0) > 2 * 1024 * 1024) throw new Error('Metadata provider response too large.');
  const body = await response.text();
  if (body.length > 2 * 1024 * 1024) throw new Error('Metadata provider response too large.');
  return JSON.parse(body) as T;
}
async function details(id: number, token: string): Promise<TmdbMovie | null> {
  const data = await providerJson<TmdbMovie>(`https://api.themoviedb.org/3/movie/${id}?language=en-US`, token);
  const dateValue = new Date(`${data.release_date}T00:00:00.000Z`);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(data.release_date) && Number.isFinite(dateValue.getTime()) && dateValue.toISOString().slice(0, 10) === data.release_date;
  if (data.id !== id || !data.title?.trim() || data.title.length > 200 || !data.original_title?.trim() || !validDate ||
      !data.overview?.trim() || data.overview.length > 5000 || !data.poster_path || !Number.isInteger(data.runtime) || data.runtime! < 30 || data.runtime! > 240 ||
      !Array.isArray(data.genres) || data.genres.length < 1 || data.genres.length > 10 || data.genres.some(genre => !genre.name?.trim())) return null;
  if (data.vote_count > 0 && (!Number.isFinite(data.vote_average) || data.vote_average < 0 || data.vote_average > 10)) return null;
  return data;
}
async function recentIds(originalLanguage: RecentLanguage, today: string, token: string): Promise<number[]> {
  const firstDay = new Date(`${today}T00:00:00.000Z`);
  firstDay.setUTCFullYear(firstDay.getUTCFullYear() - 1);
  const from = firstDay.toISOString().slice(0, 10);
  const query = new URLSearchParams({ language: 'en-US', region: 'IN', 'release_date.gte': from,
    'release_date.lte': today, with_original_language: originalLanguage, sort_by: 'popularity.desc',
    include_adult: 'false', page: '1' });
  const result = await providerJson<DiscoverResponse>(`https://api.themoviedb.org/3/discover/movie?${query}`, token);
  const limit = originalLanguage === 'en' || originalLanguage === 'hi' ? 6 : 3;
  return [...new Set(result.results.filter(movie => movie.release_date >= from && movie.release_date <= today).map(movie => movie.id))].slice(0, limit);
}

async function main() {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  if (process.env.NODE_ENV !== 'development') throw new Error('Movie catalogue updates require development mode.');
  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  if (!token) throw new Error('TMDB provider configuration is required.');
  const target = resolveDevTarget(process.env);
  const pool = new pg.Pool({ connectionString: target.url, max: 1, connectionTimeoutMillis: 2000 });
  try { await verifyDatabaseIdentity(pool, target); } finally { await pool.end(); }
  const upcoming = await providerJson<UpcomingResponse>('https://api.themoviedb.org/3/movie/upcoming?language=en-US&region=IN&page=1', token);
  const today = todayInIndia();
  const upcomingIds = [...new Map(upcoming.results.filter(item => item.release_date >= today && /^\d{4}-\d{2}-\d{2}$/.test(item.release_date)).map(item => [item.id, item])).values()].slice(0, 16).map(item => item.id);
  const recentCandidatesByLanguage = await Promise.all(RECENT_LANGUAGES.map(language => recentIds(language, today, token)));
  const [upcomingMovies, ...recentMoviesByLanguage] = await Promise.all([
    Promise.all(upcomingIds.map(id => details(id, token))),
    ...recentCandidatesByLanguage.map(ids => Promise.all(ids.map(id => details(id, token)))),
  ]);
  const hydrated = [
    ...upcomingMovies.filter((movie): movie is TmdbMovie => movie !== null && movie.release_date >= today),
    ...recentMoviesByLanguage.flatMap((movies, index) => movies.filter((movie): movie is TmdbMovie => movie !== null && movie.original_language === RECENT_LANGUAGES[index] && movie.release_date < today)),
  ];
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([import('../src/generated/prisma/client.js'), import('@prisma/adapter-pg')]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, options: '-c timezone=UTC', connectionTimeoutMillis: 2000 }) });
  try {
    const result = await prisma.$transaction(async tx => {
      const identity = (await tx.$queryRaw<Array<{ database: string; schema: string; port: number }>>`SELECT current_database() AS database, current_schema() AS schema, inet_server_port() AS port`)[0];
      if (identity?.database !== 'cinehook_dev' || identity.schema !== 'public' || identity.port !== 5432) throw new Error('Development database identity mismatch.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1667853941, 1936024934)`;
      let created = 0, createdUpcoming = 0, createdRecent = 0, skippedExisting = 0;
      const titles: { title: string; releaseDate: string }[] = [];
      for (const movie of hydrated) {
        const source = `https://www.themoviedb.org/movie/${movie.id}`;
        const language = LANGUAGES[movie.original_language] ?? movie.original_language.toLowerCase();
        const releaseDate = new Date(`${movie.release_date}T00:00:00.000Z`);
        const existing = await tx.movie.findFirst({ where: { OR: [{ metadataSourceUrl: source }, { title: movie.title, language, releaseDate }] } });
        if (existing) { skippedExisting++; continue; }
        const hasRating = movie.vote_count > 0;
        const collections = ['recommended', ...(language === 'hindi' ? ['bollywood'] : ['telugu', 'tamil', 'kannada', 'malayalam'].includes(language) ? ['south'] : [])];
        const row = await tx.movie.create({ data: {
          id: seedId(`tmdb-upcoming:${movie.id}`), title: movie.title, description: movie.overview.trim(), durationMinutes: movie.runtime!, releaseDate,
          language, genres: movie.genres.map(genre => genre.name.toLowerCase()), posterUrl: `https://image.tmdb.org/t/p/w500${movie.poster_path}`,
          backdropUrl: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : null, collections,
          metadataSourceUrl: source, artworkKind: 'TMDB', artworkSourceUrl: source, artworkAttribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
          ratingValue: hasRating ? movie.vote_average : null, ratingVoteCount: hasRating ? movie.vote_count : null, ratingSource: hasRating ? 'TMDB' : null,
          ratingSourceUrl: hasRating ? source : null, ratingFetchedAt: hasRating ? new Date() : null, isActive: true,
        } });
        created++; if (movie.release_date >= today) createdUpcoming++; else createdRecent++;
        titles.push({ title: row.title, releaseDate: movie.release_date });
      }
      return { createdMovies: created, createdUpcoming, createdRecent, skippedExisting, upcomingCandidates: upcomingIds.length,
        recentCandidates: recentCandidatesByLanguage.reduce((count, ids) => count + ids.length, 0), titles };
    }, { isolationLevel: 'ReadCommitted', maxWait: 30000, timeout: 60000 });
    console.log(JSON.stringify({ database: target.database, ...result }));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => {
  const message = error instanceof Error ? error.message : '';
  const name = error instanceof Error ? error.name : '';
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
  const meta = error && typeof error === 'object' && 'meta' in error && error.meta && typeof error.meta === 'object' ? error.meta : null;
  const databaseCode = meta && 'code' in meta && typeof meta.code === 'string' ? meta.code : '';
  const safeDetail = message.replace(/postgres(?:ql)?:\/\/[^\s'\"]+/gi, '[database URL redacted]')
    .replace(/\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '[credential redacted]').slice(-320);
  console.error(/^Metadata provider returned HTTP \d{3}\.$/.test(message) || message === 'TMDB provider configuration is required.' || message === 'Movie catalogue updates require development mode.'
    ? message : name === 'TypeError' ? 'TMDB could not be reached from this environment; no catalogue changes were made.'
      : name.startsWith('Prisma') ? `The local catalogue update was rejected (${code || name}${databaseCode ? `/${databaseCode}` : ''})${safeDetail ? `: ${safeDetail}` : ''}; no destructive changes were made.`
        : name === 'SyntaxError' ? 'TMDB returned unreadable metadata; no catalogue changes were made.'
          : 'Upcoming movie update stopped safely. Check the local database and provider setup.');
  process.exitCode = 1;
});
