import { useEffect, useReducer, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { wishlistApi } from '../api/wishlist'
import { useSession } from '../app/session-context'

export function WishlistButton({ movieId }: { movieId: string }) {
  const session = useSession(), location = useLocation(), navigate = useNavigate(), request = useRef<AbortController | null>(null)
  const owner = session.user?.id
  const key = `${session.token}:${session.user?.id}:${movieId}`
  const [result, setResult] = useState<{ key: string; saved: boolean; error?: Error }>(), [busyKey, setBusyKey] = useState(''), [feedback, setFeedback] = useState<{ key: string; error: string }>()
  const [revision, retry] = useReducer((value: number) => value + 1, 0)
  useEffect(() => () => request.current?.abort(), [key])
  useEffect(() => {
    if (!owner) return
    let readController: AbortController | null = null
    const read = () => {
      readController?.abort()
      const controller = new AbortController(); readController = controller
      wishlistApi.status(movieId, controller.signal).then(response => {
        if (!controller.signal.aborted) setResult({ key, saved: response.saved })
      }, error => {
        if (!controller.signal.aborted) setResult(previous => ({ key, saved: previous?.key === key ? previous.saved : false, error: error instanceof Error ? error : new Error('Unable to read wishlist status.') }))
      })
    }
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ owner: string; movieId: string; saved: boolean }>).detail
      if (detail?.owner === `${session.token}:${owner}` && detail.movieId === movieId) {
        readController?.abort()
        setResult({ key, saved: detail.saved })
        read()
      }
    }
    read()
    window.addEventListener('focus', read)
    window.addEventListener('cinehook:wishlist-changed', changed)
    return () => { readController?.abort(); window.removeEventListener('focus', read); window.removeEventListener('cinehook:wishlist-changed', changed) }
  }, [key, owner, session.token, movieId, revision])
  const current = result?.key === key ? result : undefined
  const saved = !!owner && (current?.saved ?? false), error = feedback?.key === key ? feedback.error : ''
  const active = busyKey === key
  return <div className="wishlist-control"><button className={`secondary wishlist-button ${saved ? 'saved' : ''}`} aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'} aria-pressed={saved} disabled={!!active || (!!owner && !current)} onClick={async () => {
    if (!session.user) { navigate(`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`); return }
    if (request.current && !request.current.signal.aborted) return
    if (current?.error) { retry(); return }
    const controller = new AbortController(); request.current = controller; setBusyKey(key); setFeedback({ key, error: '' })
    try { const response = await (saved ? wishlistApi.remove(movieId, controller.signal) : wishlistApi.save(movieId, controller.signal)); if (!controller.signal.aborted) window.dispatchEvent(new CustomEvent('cinehook:wishlist-changed', { detail: { owner: `${session.token}:${owner}`, movieId, saved: response.saved } })) }
    catch (value) { if (!controller.signal.aborted) setFeedback({ key, error: value instanceof Error ? value.message : 'Unable to update wishlist.' }) }
    finally { if (!controller.signal.aborted) { request.current = null; setBusyKey('') } }
  }}><span aria-hidden="true">{saved ? '♥' : '♡'}</span>{active ? 'Updating…' : saved ? 'Saved' : 'My Wishlist'}</button>{(error || current?.error) && <p className="text-red-300 text-xs mt-2" role="alert">{error || 'Wishlist status unavailable. Select the button to retry.'}</p>}</div>
}
