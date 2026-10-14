import { useState } from 'react'
import type { Movie } from '../api/types'
export function MediaCredits({ movie }: { movie: Movie }) {
  const [missingLogo, setMissingLogo] = useState(false)
  const usesTmdb = movie.artwork?.kind === 'TMDB' || movie.rating?.provider === 'TMDB' || Boolean(movie.trailer)
  return <details className="panel media-credits"><summary>About &amp; media credits</summary><p>{movie.artwork?.attribution ?? 'Movie artwork is shown where available.'}</p>{usesTmdb && <><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>{missingLogo ? <p className="muted">TMDB attribution logo unavailable.</p> : <img className="tmdb-logo" src="/provider-assets/tmdb-logo.svg" alt="TMDB" onError={() => setMissingLogo(true)} />}<a className="accent" href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">The Movie Database ↗</a></>}<p>Ratings appear only when verified. Scores from IMDb and Rotten Tomatoes are not currently available.</p><p>English and Hindi synopses are original summaries. Sample screenings are not public cinema listings.</p></details>
}
