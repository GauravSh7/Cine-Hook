import type { Movie, Prisma } from '../../generated/prisma/client.js';

export type MovieRead = Movie & { shows?: { id: string; startsAt: Date }[] };
export const COLLECTION_KEYS = ['recommended', 'bollywood', 'south', 'popular', 'picks', 'featured'] as const;
export const RATING_TTL_MS = 7 * 86400000;
export function safeArtworkUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\/demo-art\/[a-z0-9]+(?:-[a-z0-9]+)*-(?:poster|backdrop)\.svg$/.test(value)) return value;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? value : null; } catch { return null; }
}
export function upcomingShowInclude(cityId?: string, now = new Date()) {
  return { shows: { where: { status: 'SCHEDULED' as const, startsAt: { gt: now },
    screen: { theatre: { cityId } } }, select: { id: true, startsAt: true }, orderBy: { startsAt: 'asc' as const }, take: 1 } } satisfies Prisma.MovieInclude;
}
export const movieMetadataSelect = { backdropUrl: true, collections: true, metadataSourceUrl: true, artworkKind: true,
  descriptionHindi: true, trailerVideoId: true, trailerSourceUrl: true, trailerVerifiedAt: true,
  artworkAttribution: true, artworkSourceUrl: true, ratingValue: true, ratingVoteCount: true,
  ratingSource: true, ratingSourceUrl: true, ratingFetchedAt: true } as const;
/** Pure projection: provenance and bookability are supplied by repository reads. */
export function publicMovie(movie: MovieRead, cityId?: string, now = new Date()) {
  const posterUrl = safeArtworkUrl(movie.posterUrl), backdropUrl = safeArtworkUrl(movie.backdropUrl);
  const sourceUrl = safeArtworkUrl(movie.artworkSourceUrl);
  const artwork = (movie.artworkKind === 'ILLUSTRATION' && (posterUrl?.startsWith('/demo-art/') || backdropUrl?.startsWith('/demo-art/'))
    || movie.artworkKind === 'TMDB' && sourceUrl?.startsWith('https://www.themoviedb.org/')) && movie.artworkAttribution
    ? { kind: movie.artworkKind as 'ILLUSTRATION' | 'TMDB', sourceUrl, attribution: movie.artworkAttribution } : null;
  const verifiedAt = movie.ratingFetchedAt;
  const ratingUrl = safeArtworkUrl(movie.ratingSourceUrl);
  const rating = movie.ratingSource === 'TMDB' && ratingUrl?.match(/^https:\/\/www\.themoviedb\.org\/movie\/\d+$/)
    && Number.isFinite(movie.ratingValue) && movie.ratingValue! >= 0 && movie.ratingValue! <= 10
    && Number.isInteger(movie.ratingVoteCount) && movie.ratingVoteCount! > 0 && verifiedAt instanceof Date
    && Number.isFinite(verifiedAt.getTime()) && verifiedAt <= now && now.getTime() - verifiedAt.getTime() <= RATING_TTL_MS
    ? { provider: 'TMDB' as const, value: movie.ratingValue!, scale: 10 as const, voteCount: movie.ratingVoteCount!, sourceUrl: ratingUrl, verifiedAt: verifiedAt.toISOString() } : null;
  const trailer = typeof movie.trailerVideoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(movie.trailerVideoId)
    && /^https:\/\/www\.themoviedb\.org\/movie\/[1-9]\d*$/.test(movie.trailerSourceUrl ?? '')
    && movie.trailerVerifiedAt instanceof Date && Number.isFinite(movie.trailerVerifiedAt.getTime()) && movie.trailerVerifiedAt <= now
    ? { provider: 'YouTube' as const, videoId: movie.trailerVideoId, sourceUrl: movie.trailerSourceUrl!, verifiedAt: movie.trailerVerifiedAt.toISOString() } : null;
  return { id: movie.id, title: movie.title, description: movie.description, descriptionHindi: movie.descriptionHindi || null, trailer, durationMinutes: movie.durationMinutes,
    releaseDate: movie.releaseDate, language: movie.language, genres: movie.genres, posterUrl, backdropUrl,
    collections: (movie.collections ?? []).filter(key => (COLLECTION_KEYS as readonly string[]).includes(key)),
    metadataSourceUrl: safeArtworkUrl(movie.metadataSourceUrl), artwork, rating,
    bookingAvailability: { cityId: cityId ?? null, hasShows: movie.isActive && Boolean(movie.shows?.length), nextShowStartsAt: movie.shows?.[0]?.startsAt ?? null },
    isActive: movie.isActive, createdAt: movie.createdAt, updatedAt: movie.updatedAt };
}
