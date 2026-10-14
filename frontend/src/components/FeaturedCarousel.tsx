import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { Movie } from '../api/types'
import { useNow } from '../app/use-now'
import { Poster } from './MovieCard'

export function FeaturedCarousel({ movies }: { movies: Movie[] }) {
  const [index, setIndex] = useState(0), [focus, setFocus] = useState(false)
  const now = useNow()
  const [hidden, setHidden] = useState(document.hidden)
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const paused = focus || hidden || reduced
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const motion = () => setReduced(media?.matches ?? false)
    const visibility = () => setHidden(document.hidden)
    media?.addEventListener('change', motion)
    document.addEventListener('visibilitychange', visibility)
    return () => { media?.removeEventListener('change', motion); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  useEffect(() => {
    if (paused || movies.length < 2) return
    const timer = window.setInterval(() => setIndex(value => (value + 1) % movies.length), 5000)
    return () => clearInterval(timer)
  }, [paused, movies.length])
  const active = index % movies.length
  const move = (value: number) => setIndex((value + movies.length) % movies.length)
  return <section className="featured-hero" aria-label="Featured movies" aria-roledescription="carousel" onFocusCapture={() => setFocus(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocus(false) }}>
    <div className="hero-track" style={{ transform: `translateX(-${active * 100}%)` }}>{movies.map((movie, i) => <div key={movie.id} className="hero-slide" aria-hidden={i !== active} inert={i !== active}>
      <Poster movie={movie} backdrop className="hero-landscape" /><div className="hero-shade" />
      <div className="hero-copy"><h1>{movie.title}</h1><Link className="btn" to={`/movies/${movie.id}`}>{Date.parse(movie.releaseDate) > now ? 'Coming Soon' : 'Book Now'}</Link></div>
    </div>)}</div>
    {movies.length > 1 && <div className="hero-controls"><button className="carousel-arrow" aria-label="Previous featured movie" onClick={() => move(active - 1)}>←</button><div className="carousel-dots">{movies.map((movie, i) => <button key={movie.id} aria-label={`Show ${movie.title}`} aria-pressed={active === i} onClick={() => move(i)} />)}</div><button className="carousel-arrow" aria-label="Next featured movie" onClick={() => move(active + 1)}>→</button></div>}
  </section>
}
