import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link } from 'react-router'
import { wishlistApi } from '../api/wishlist'
import { useSession } from '../app/session-context'
import { usePagedAsync } from '../app/use-paged-async'
import { ScrollMore } from '../components/ScrollMore'
import { AccountLayout } from '../components/AccountLayout'
import { Poster } from '../components/MovieCard'
import { EmptyState, ErrorState, Loading } from '../components/feedback'

export function WishlistPage() {
  const session = useSession(), [page, setPage] = useState(1), [busy, setBusy] = useState(''), [error, setError] = useState('')
  const [version, refill] = useReducer((value: number) => value + 1, 0)
  const request = useRef<AbortController | null>(null), key = `${session.token}:${session.user!.id}:${version}`
  const load = useCallback((signal: AbortSignal) => wishlistApi.list({ page }, signal), [page])
  const resource = usePagedAsync(key, load, page)
  useEffect(() => () => request.current?.abort(), [key])
  const items = resource.data?.items ?? []
  return <AccountLayout title="My Wishlist" detail="Movies saved to your account"><section>{error && <p role="alert" className="text-red-300 mb-4">{error}</p>}{resource.loading ? <Loading label="Loading wishlist…"/> : resource.error ? <ErrorState error={resource.error} retry={resource.reload}/> : items.length ? <div className="movie-grid wishlist-grid">{items.map(({ movie }) => <article className="movie-card" key={movie.id}>{movie.isActive ? <Link to={`/movies/${movie.id}`}><Poster movie={movie}/><h2>{movie.title}</h2></Link> : <><Poster movie={movie}/><h2>{movie.title}</h2></>}<p className="muted px-3 text-xs">{movie.genres.join(' / ')} · {movie.language}</p><button className="danger-outline m-3" disabled={!!busy} aria-label={`Remove ${movie.title}`} onClick={async () => {
      if (request.current && !request.current.signal.aborted) return
      const controller = new AbortController(); request.current = controller; setBusy(movie.id); setError('')
      try { const response = await wishlistApi.remove(movie.id, controller.signal); if (!controller.signal.aborted && !response.saved) {setPage(1); refill()} }
      catch (value) { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : 'Unable to remove movie.') }
      finally { if (!controller.signal.aborted) { request.current = null; setBusy('') } }
    }}>{busy === movie.id ? 'Removing…' : 'Remove'}</button></article>)}</div> : <EmptyState title={page === 1 ? 'Your wishlist is empty' : 'No movies on this page'} detail="Save a movie from its card or details page."/>}<ScrollMore {...resource} loadingMore={resource.loadingMore || !!busy} next={() => setPage(p => p + 1)} retry={resource.reload}/></section></AccountLayout>
}
