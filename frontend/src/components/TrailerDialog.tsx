import { useEffect, useRef } from 'react'
import type { Movie } from '../api/types'
import { hasTrustedTrailer } from '../domain/movie-media'
export function TrailerDialog({ movie, onClose }: { movie: Movie; onClose(): void }) {
  const close = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; close.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  if (!hasTrustedTrailer(movie)) return null
  return <div className="dialog-backdrop trailer-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}><section className="panel trailer-dialog" role="dialog" aria-modal="true" aria-label={`${movie.title} — official trailer`} ref={panel} onKeyDown={event => {
    if (event.key === 'Escape') onClose()
    if (event.key === 'Tab') {
      const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button, iframe, a[href]') ?? [])
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus() }
    }
  }}><div className="trailer-heading"><h2>{movie.title} — official trailer</h2><button ref={close} className="icon-button" aria-label="Close trailer" onClick={onClose}>×</button></div><div className="trailer-player"><iframe title={`${movie.title} official trailer`} src={`https://www.youtube-nocookie.com/embed/${movie.trailer!.videoId}?autoplay=1&rel=0`} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div><p className="muted">If the distributor restricts embedding, <a className="accent" href={`https://www.youtube.com/watch?v=${movie.trailer!.videoId}`} target="_blank" rel="noopener noreferrer">watch on YouTube ↗</a>. Opening the player contacts YouTube. <a href={movie.trailer!.sourceUrl} target="_blank" rel="noopener noreferrer">Trailer metadata source</a></p></section></div>
}
