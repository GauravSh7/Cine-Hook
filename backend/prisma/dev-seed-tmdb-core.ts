import { z } from 'zod';
import type { Movie, Prisma } from '../src/generated/prisma/client.js';
import { publicMovie } from '../src/modules/catalog/public-movie.js';

type Store = { findById(id: string): Promise<Movie | null>; update(id: string, data: Prisma.MovieUpdateInput): Promise<unknown> };
type Options = { nodeEnv?: string; token?: string; movieId: string; tmdbId: number; now?: Date; includeTrailer?: boolean; preserveMedia?: boolean };
const imagePath = z.string().regex(/^\/[A-Za-z0-9]+\.jpg$/).max(200).nullable();
const providerMovie = z.object({ id: z.number().int().positive(), title: z.string().min(1).max(200), original_title: z.string().min(1).max(200),
  original_language: z.enum(['hi', 'te', 'ta', 'kn', 'en']), release_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vote_average: z.number().finite().min(0).max(10), vote_count: z.number().int().min(1).max(2147483647),
  poster_path: imagePath, backdrop_path: imagePath });
const languages: Record<string, string> = { hi: 'hindi', te: 'telugu', ta: 'tamil', kn: 'kannada', en: 'english' };
const normalize = (title: string) => title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
export function matchesTmdbMovie(movie: Pick<Movie, 'title' | 'language' | 'releaseDate'>, candidate: { title: string; original_title: string; original_language: string; release_date: string }): boolean {
  const aliases: Record<string, string[]> = {
    salaarpart1ceasefire: ['Salaar: Part I - Ceasefire'],
    stree2: ['Stree 2: Sarkate Ka Aatank'],
    baahubali2theconclusion: ['Bāhubali 2: The Conclusion'],
    lagaan: ['Lagaan: Once Upon a Time in India'],
  };
  const titles = [movie.title, ...(aliases[normalize(movie.title)] ?? [])].map(normalize);
  return languages[candidate.original_language] === movie.language
    && /^\d{4}-\d{2}-\d{2}$/.test(candidate.release_date)
    && candidate.release_date.slice(0, 4) === movie.releaseDate.toISOString().slice(0, 4)
    && [candidate.title, candidate.original_title].some(title => titles.includes(normalize(title)));
}

/** Manual development importer only. A complete valid tuple is the seven-day cache. */
export async function importTmdbMovie(store: Store, options: Options, request: typeof fetch = fetch): Promise<{ status: 'unavailable' | 'cached' | 'updated' }> {
  if (options.nodeEnv !== 'development') throw new Error('TMDB import requires NODE_ENV=development.');
  if (!options.token) return { status: 'unavailable' };
  if (!z.string().uuid().safeParse(options.movieId).success || !Number.isSafeInteger(options.tmdbId) || options.tmdbId < 1)
    throw new Error('TMDB import requires an exact movie UUID and positive TMDB ID.');
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('TMDB import requires a valid clock.');
  const movie = await store.findById(options.movieId);
  if (!movie) return { status: 'unavailable' };
  const sourceUrl = `https://www.themoviedb.org/movie/${options.tmdbId}`;
  if (movie.ratingSourceUrl === sourceUrl && publicMovie(movie, undefined, now).rating
    && (options.preserveMedia || !options.includeTrailer || publicMovie(movie, undefined, now).trailer)) return { status: 'cached' };
  let data: z.infer<typeof providerMovie>;
  try {
    const response = await request(`https://api.themoviedb.org/3/movie/${options.tmdbId}`, {
      headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 1024 * 1024) return { status: 'unavailable' };
    const body = await response.text();
    if (body.length > 1024 * 1024) return { status: 'unavailable' };
    const parsed = providerMovie.safeParse(JSON.parse(body));
    if (!parsed.success) return { status: 'unavailable' };
    data = parsed.data;
  } catch { return { status: 'unavailable' }; } // Never log provider errors or credentials.
  if (data.id !== options.tmdbId || !matchesTmdbMovie(movie, data))
    return { status: 'unavailable' };
  const updates: Prisma.MovieUpdateInput = { ratingValue: data.vote_average, ratingVoteCount: data.vote_count,
    ratingSource: 'TMDB', ratingSourceUrl: sourceUrl, ratingFetchedAt: now };
  // Partial provider art never destroys a useful original or mismatches attribution.
  if (!options.preserveMedia && data.poster_path && data.backdrop_path) Object.assign(updates, {
    posterUrl: `https://image.tmdb.org/t/p/w500${data.poster_path}`, backdropUrl: `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`,
    artworkKind: 'TMDB', artworkSourceUrl: sourceUrl,
    artworkAttribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.' });
  if (!options.preserveMedia && options.includeTrailer) {
    try {
      const response = await request(`https://api.themoviedb.org/3/movie/${options.tmdbId}/videos`, {
        headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (response.ok && Number(response.headers.get('content-length') ?? 0) <= 1024 * 1024) {
        const body = await response.text();
        if (body.length <= 1024 * 1024) {
          const parsed = z.object({ id: z.number().int(), results: z.array(z.object({ key: z.string(), site: z.string(), official: z.boolean(), type: z.string() })).max(1000) }).safeParse(JSON.parse(body));
          if (parsed.success && parsed.data.id === options.tmdbId) {
            const video = parsed.data.results.find(video => video.site === 'YouTube' && video.official === true && video.type === 'Trailer' && /^[A-Za-z0-9_-]{11}$/.test(video.key));
            if (video) Object.assign(updates, { trailerVideoId: video.key, trailerSourceUrl: sourceUrl, trailerVerifiedAt: now });
          }
        }
      }
    } catch { /* Missing videos do not destroy existing art, ratings or trailer evidence. */ }
  }
  await store.update(movie.id, updates);
  return { status: 'updated' };
}
