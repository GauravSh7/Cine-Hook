import { useId, useRef } from 'react'
import type { Movie } from '../api/types'
import { MovieCard } from './MovieCard'

export function MovieRail({ title, subtitle, movies }: { title: string; subtitle: string; movies: Movie[] }) {
  const rail = useRef<HTMLDivElement>(null), heading = useId()
  if (!movies.length) return null
  const scroll = (direction: number) => rail.current?.scrollBy({ left: direction * rail.current.clientWidth * .85, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  return <section className="catalog-section" aria-labelledby={heading}><div className="section-heading"><div><h2 id={heading}>{title}</h2><p>{subtitle}</p></div><div className="rail-controls"><button className="carousel-arrow" aria-label={`Previous ${title}`} onClick={() => scroll(-1)}>←</button><button className="carousel-arrow" aria-label={`Next ${title}`} onClick={() => scroll(1)}>→</button></div></div><div className="movie-rail" ref={rail}>{[...new Map(movies.map(movie => [movie.id, movie])).values()].map(movie => <MovieCard key={movie.id} movie={movie} />)}</div></section>
}
