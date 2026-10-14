import { useState } from 'react'
import { Link } from 'react-router'
import type { Movie } from '../api/types'
import { useNow } from '../app/use-now'

export function Poster({ movie, className = '', backdrop = false }: { movie: Movie; className?: string; backdrop?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  const source = backdrop ? movie.backdropUrl ?? movie.posterUrl : movie.posterUrl
  return <div className={`poster ${className}`}>{source && failed !== source
    ? <img src={source} alt={`${movie.title} ${backdrop ? 'backdrop' : 'poster'}`} loading={backdrop ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => setFailed(source)} />
    : <span aria-hidden="true">{movie.title.slice(0, 1)}</span>}</div>
}
export function MovieCard({ movie }: { movie: Movie }) {
  const comingSoon = Date.parse(movie.releaseDate) > useNow()
  const action = comingSoon ? 'Coming Soon' : 'Book Now'
  return <article className="movie-card"><Link to={`/movies/${movie.id}`}><Poster movie={movie} />
    <div className="card-copy"><h3 className="font-semibold">{movie.title}</h3><p className="muted text-sm capitalize">{movie.genres.join(' / ')} · {movie.language}</p>
      {movie.rating && <p className="card-rating">★ {movie.rating.value.toFixed(1)}/{movie.rating.scale} · {movie.rating.provider}</p>}</div></Link><div className="card-action"><Link className="btn" to={`/movies/${movie.id}`}>{action}</Link></div></article>
}
