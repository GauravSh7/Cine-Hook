import { useState } from 'react'
import type { Movie } from '../api/types'
export function MediaCredits({ movie }: { movie: Movie }) {
  const [missingLogo, setMissingLogo] = useState(false)
  const usesTmdb = movie.artwork?.kind === 'TMDB' || movie.rating?.provider === 'TMDB' || Boolean(movie.trailer)
  return <details className="panel media-credits"><summary>About &amp; media credits</summary>{movie.artwork?.attribution && !usesTmdb && <p>{movie.artwork.attribution}</p>}{usesTmdb && <><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>{missingLogo ? <p className="muted">TMDB attribution logo unavailable.</p> : <img className="tmdb-logo" src="/provider-assets/tmdb-logo.svg" alt="TMDB" onError={() => setMissingLogo(true)} />}<a className="accent" href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">The Movie Database ↗</a></>}<p>Movie artwork belongs to its respective rights holders. Provider scores and trailers are shown only where available.</p></details>
}
