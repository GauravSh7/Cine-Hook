import type { Movie } from '../api/types'
export function hasTrustedTrailer(movie: Movie): boolean {
  return movie.trailer?.provider === 'YouTube' && /^[A-Za-z0-9_-]{11}$/.test(movie.trailer.videoId)
    && /^https:\/\/www\.themoviedb\.org\/movie\/[1-9]\d*$/.test(movie.trailer.sourceUrl)
}
