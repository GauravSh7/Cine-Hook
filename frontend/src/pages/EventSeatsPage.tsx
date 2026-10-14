import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { eventsApi } from '../api/events'
import { getServerNow } from '../api/client'
import { useAsync } from '../app/use-async'
import { useSession } from '../app/session-context'
import { ErrorState, Loading } from '../components/feedback'
import { EventVenueMap } from '../components/EventVenueMap'
import { money } from '../domain/time'
import { seatLabel } from '../domain/booking-target'
import { FocusedLayout } from '../components/FocusedLayout'

export function EventSeatsPage() {
  const { id = '' } = useParams(), navigate = useNavigate(), owner = useSession(), storageKey = `cinehook.event-seats.${id}`
  const [selected, setSelected] = useState<string[]>(() => { try { const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]'); return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string'))].slice(0, 10) : [] } catch { return [] } })
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null), [now, setNow] = useState(getServerNow)
  const request = useRef<AbortController | null>(null)
  const load = useCallback((signal: AbortSignal) => eventsApi.session(id, signal), [id]), inventory = useCallback((signal: AbortSignal) => eventsApi.availability(id, signal), [id])
  const resource = useAsync(`event-seat-session:${id}`, load, 5000), availability = useAsync(`event-availability:${id}`, inventory, 5000)
  useEffect(() => { const timer = window.setInterval(() => setNow(getServerNow()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => () => request.current?.abort(), [])
  const persistedEvent = resource.data?.session.id === id ? resource.data.session.event : undefined
  const eventBackTo = persistedEvent ? `/${persistedEvent.kind.toLowerCase()}/bookable/${persistedEvent.id}` : undefined
  if (resource.loading || availability.loading) return <FocusedLayout eventBackTo={eventBackTo}><main className="page-shell"><Loading label="Loading venue and numbered seats…" /></main></FocusedLayout>
  if (resource.error || availability.error) return <FocusedLayout eventBackTo={eventBackTo}><main className="page-shell"><ErrorState error={(resource.error ?? availability.error)!} retry={() => { resource.reload(); availability.reload() }} /><Link className="secondary mt-5" to={eventBackTo ?? '/events'}>Explore experiences</Link></main></FocusedLayout>
  const detail = resource.data!.session, physical = detail.venue.sections.flatMap(section => section.seats), seats = availability.data!.seats.filter(seat => availability.data!.eventSessionId === detail.id && physical.some(item => item.id === seat.id && item.sectionId === seat.sectionId && item.rowName === seat.rowName && item.seatNumber === seat.seatNumber && item.ticketTier === seat.ticketTier))
  const choice = selected.filter(seatId => seats.some(seat => seat.id === seatId && seat.availability === 'AVAILABLE'))
  const bookable = detail.id === id && detail.status === 'SCHEDULED' && detail.event.isActive && Date.parse(detail.startsAt) > now
  const labels = choice.map(seatId => { const seat = seats.find(item => item.id === seatId)!; return seatLabel({ ...seat, sectionName: detail.venue.sections.find(section => section.id === seat.sectionId)!.name }) })
  const toggle = (seatId: string) => {
    const next = choice.includes(seatId) ? choice.filter(value => value !== seatId) : choice.length < 10 ? [...choice, seatId] : choice
    setSelected(next); try { sessionStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* An optional selection is not a hold. */ }
  }
  const submit = async () => {
    if (!bookable || !choice.length || busy) return
    if (!owner.user) { navigate(`/login?returnTo=${encodeURIComponent(`/event-sessions/${id}/seats`)}`); return }
    setBusy(true); setError(null)
    const controller = new AbortController(); request.current = controller
    try { const { booking } = await eventsApi.createBooking(id, choice, controller.signal); if (controller.signal.aborted) return; try { sessionStorage.removeItem(storageKey) } catch { /* Optional preference only. */ } navigate(`/bookings/${booking.id}/checkout`) }
    catch (value) { if (!controller.signal.aborted) { setError(value instanceof Error ? value : new Error('Unable to hold seats. Check booking history before trying again.')); availability.reload() } }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <FocusedLayout eventBackTo={eventBackTo}><main className="event-seat-page"><header className="event-seat-heading"><h1>Choose your seats</h1>
    {!bookable && <p role="alert">This session is no longer available. Choose another session.</p>}
  </header><EventVenueMap session={detail} seats={seats} selected={choice} disabled={busy || !bookable} onToggle={toggle} />
    <div className="event-tier-prices seat-tier-prices">{detail.prices.map(price => <span key={price.ticketTier}>{price.ticketTier} <strong>{money(price.pricePaise)}</strong> / seat</span>)}</div>
    {error && <div className="event-hold-error"><ErrorState error={error} retry={availability.reload} /><Link className="accent" to="/bookings">Check My Bookings if the request timed out</Link></div>}
    <footer className="event-selection-footer"><div><p className="muted text-xs">Selected seats · {choice.length}/10</p><p role="status" aria-label="Selected seats" aria-live="polite">{labels.join(', ') || 'None'}</p>{choice.length === 10 && <small>Maximum 10 seats per booking.</small>}</div><div><p className="muted text-xs">Seat estimate</p><strong>{money(choice.reduce((total, seatId) => total + seats.find(seat => seat.id === seatId)!.pricePaise, 0))}</strong></div><button className="btn" disabled={!choice.length || busy || !bookable || owner.status === 'checking'} onClick={submit}>{busy ? 'Holding seats…' : 'Continue'}</button></footer>
  </main></FocusedLayout>
}
