import { z } from 'zod';
import { HINDI_TMDB_SUMMARIES } from './refinement-manifest.js';

const localizedMovie = z.object({ id: z.number().int().positive(), overview: z.string().max(5000) }).strict();

/** Keep only a matching TMDB Hindi overview that contains actual Devanagari text. */
export function verifiedHindiOverview(expectedMovieId: number, payload: unknown): string | null {
  const parsed = localizedMovie.safeParse(payload);
  if (!parsed.success || parsed.data.id !== expectedMovieId) return null;
  const overview = parsed.data.overview.trim();
  return overview.length >= 8 && /\p{Script=Devanagari}/u.test(overview) ? overview : null;
}

/** Return a locally authored Hindi summary only for a movie with the matching verified TMDB source URL. */
export function curatedHindiSummary(expectedMovieId: number, sourceUrl: string | null): string | null {
  if (!Number.isSafeInteger(expectedMovieId) || expectedMovieId < 1) return null;
  const sourceId = sourceUrl?.match(/^https:\/\/www\.themoviedb\.org\/movie\/([1-9]\d*)$/)?.[1];
  if (sourceId !== String(expectedMovieId)) return null;
  const summary = HINDI_TMDB_SUMMARIES[sourceId];
  return summary && summary.length >= 8 && /\p{Script=Devanagari}/u.test(summary) ? summary : null;
}
