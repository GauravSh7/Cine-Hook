import { useCallback, useEffect, useId, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { catalogApi } from '../api/catalog'
import { bookingApi } from '../api/booking'
import { useSession } from '../app/session-context'
import { useAsync } from '../app/use-async'
import { ErrorState, Loading } from '../components/feedback'
import { formatDateTime, money } from '../domain/time'
import {publicVenueLabel} from '../domain/customer-copy'
import '../components/venue-polish.css'

export function SeatsPage() {
  const { id = '' } = useParams(), navigate = useNavigate(), session = useSession(), storageKey = `cinehook.seats.${id}`
  const [selected, setSelected] = useState<string[]>(() => { try { const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]'); return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 10) : [] } catch { return [] } })
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null)
  const showLoad = useCallback((signal: AbortSignal) => catalogApi.show(id, signal), [id])
  const load = useCallback((signal: AbortSignal) => catalogApi.availability(id, signal), [id])
  const show = useAsync(`seat-show:${id}`, showLoad, 5000), availability = useAsync(`availability:${id}`, load, 5000)
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  if (show.loading || availability.loading) return <main className="page-shell"><Loading label="Loading seat layout…" /></main>
  if (show.error || availability.error) return <main className="page-shell"><ErrorState error={(show.error ?? availability.error)!} retry={() => { show.reload(); availability.reload() }} /></main>
  const seats = availability.data!.seats, choice = selected.filter(seatId => seats.some(seat => seat.id === seatId && seat.availability === 'AVAILABLE'))
  const rows = [...new Set(seats.map(seat => seat.rowName))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), detail = show.data!.show
  const bookable = detail.status === 'SCHEDULED' && new Date(detail.startsAt).getTime() > now && detail.movie.isActive
  const maxSeat = Math.max(1, ...seats.map(seat => seat.seatNumber))
  const aisleAfter = Math.ceil(maxSeat / 2)
  const toggle = (seatId: string) => {
    const next = choice.includes(seatId) ? choice.filter(value => value !== seatId) : choice.length < 10 ? [...choice, seatId] : choice
    setSelected(next); try { sessionStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Selection isn't a hold. */ }
  }
  const submit = async () => {
    if (!bookable || !choice.length || busy) return
    if (!session.user) { navigate(`/login?returnTo=${encodeURIComponent(`/shows/${id}/seats`)}`); return }
    setBusy(true); setError(null)
    try { const { booking } = await bookingApi.create(id, choice); try { sessionStorage.removeItem(storageKey) } catch { /* Optional selection only. */ } navigate(`/bookings/${booking.id}/checkout`) }
    catch (value) { setError(value instanceof Error ? value : new Error('Unable to hold seats. Please refresh.')); availability.reload() }
    finally { setBusy(false) }
  }
  return <main className="seat-page"><div className="px-6 py-10 text-center"><h1 className="text-3xl font-semibold">Choose your seats</h1>
    <p className="muted mt-2 text-sm">{detail.movie.title} • {publicVenueLabel(detail.screen.theatre.name)} • {formatDateTime(detail.startsAt)}</p>
    {!bookable && <p role="alert" className="mt-4 text-amber-300">This show is no longer available for booking. Choose another screening.</p>}
    <div className="cinema-auditorium" data-hall-variant={detail.screen.capacity >= 80 ? 'grand' : 'medium'}>
    <div className="cinema-hall-name"><span>{publicVenueLabel(detail.screen.name)}</span><small>{seats.length} seats · {rows.length} rows</small></div>
    <CinemaScreen />
    <p className="cinema-map-hint muted" id="cinema-map-help">Screen at the front · Scroll across to explore. Tab to a seat, then Enter or Space to select.</p>
    <div className="seat-scroll" role="region" aria-label="Seat map, horizontally scrollable" aria-describedby="cinema-map-help" tabIndex={0}>
      <div className="seat-grid">{rows.map((row, rowIndex) => {
        const rowSeats = seats.filter(seat => seat.rowName === row), tiers = [...new Set(rowSeats.map(seat => seat.seatType))].sort().join(' / ')
        const previousTiers = rowIndex ? [...new Set(seats.filter(seat => seat.rowName === rows[rowIndex - 1]).map(seat => seat.seatType))].sort().join(' / ') : ''
        return <div className="cinema-row-band" data-seat-tier={tiers.toLowerCase()} key={row}>
        {tiers !== previousTiers && <div className="cinema-tier-heading"><span>{tiers}</span><i aria-hidden="true" /></div>}
        <div className="seat-row" style={{ gridTemplateColumns: `28px repeat(${aisleAfter}, 44px) 28px repeat(${maxSeat - aisleAfter}, 44px) 28px` }}><span className="row-label">{row}</span>
        {seats.filter(seat => seat.rowName === row).sort((a, b) => a.seatNumber - b.seatNumber).map(seat => <button key={seat.id} type="button" disabled={seat.availability !== 'AVAILABLE' || busy || !bookable}
          style={{ gridColumn: seat.seatNumber + 1 + (seat.seatNumber > aisleAfter ? 1 : 0), gridRow: 1 }}
          aria-label={`${seat.rowName}${seat.seatNumber} ${seat.availability === 'LOCKED' ? 'unavailable' : seat.availability.toLowerCase()} ${seat.seatType.toLowerCase()} ${money(seat.pricePaise)}`}
          aria-pressed={choice.includes(seat.id)} className={`seat seat-${seat.availability.toLowerCase()} ${choice.includes(seat.id) ? 'seat-selected' : ''}`}
          onClick={() => toggle(seat.id)}>{seat.rowName}{seat.seatNumber}</button>)}<span className="row-label cinema-row-end" aria-hidden="true" style={{ gridColumn: maxSeat + 3, gridRow: 1 }}>{row}</span></div></div>
      })}</div>
    </div></div><div className="muted mt-10 flex flex-wrap justify-center gap-5 text-sm"><span>□ Available</span><span className="accent">■ Selected</span><span>■ Unavailable</span></div>
    <div className="muted mt-4 flex flex-wrap justify-center gap-4 text-sm">{detail.prices.map(price => <span key={price.seatType}>{price.seatType}: {money(price.pricePaise)} / seat</span>)}</div>
    {error && <div className="mx-auto mt-6 max-w-2xl text-left"><ErrorState error={error} retry={availability.reload} /></div>}
  </div><div className="seat-footer"><div><p className="muted text-xs">Selected seats</p><p className="mt-1 font-semibold">{choice.map(seatId => { const seat = seats.find(value => value.id === seatId)!; return `${seat.rowName}${seat.seatNumber}` }).join(', ') || 'None'}</p></div>
    <div><p className="muted text-xs">Seat estimate</p><p className="mt-1 font-semibold">{money(choice.reduce((total, seatId) => total + (seats.find(seat => seat.id === seatId)?.pricePaise ?? 0), 0))}</p><p className="muted text-xs">Final total confirmed at checkout</p></div><button className="btn" disabled={!choice.length || busy || !bookable || session.status === 'checking'} onClick={submit}>{busy ? 'Holding seats…' : 'Continue'}</button></div>
  </main>
}

function CinemaScreen() {
  const id = useId()
  return <div className="cinema-screen"><div className="cinema-projection" aria-hidden="true" /><svg viewBox="0 0 900 270" role="img" aria-label="Cinema screen"><defs><linearGradient id={`${id}-screen`} x2="0" y2="1"><stop stopColor="#d5eeff" /><stop offset=".55" stopColor="#7eb3cd" /><stop offset="1" stopColor="#234556" /></linearGradient><radialGradient id={`${id}-horizon`}><stop stopColor="#f6eacb" /><stop offset="1" stopColor="#b7d5df" stopOpacity="0" /></radialGradient><clipPath id={`${id}-frame`}><path d="M65 35Q450 8 835 35L820 217Q450 245 80 217Z" /></clipPath></defs><path d="M50 26Q450-4 850 26L836 230Q450 263 64 230Z" fill="#131b23" stroke="#788c98" strokeWidth="2" /><g clipPath={`url(#${id}-frame)`}><path d="M65 35Q450 8 835 35L820 217Q450 245 80 217Z" fill={`url(#${id}-screen)`} /><ellipse cx="535" cy="90" rx="230" ry="100" fill={`url(#${id}-horizon)`} /><path d="m45 215 130-99 123 75 107-45 168 78 143-125 136 123 55-40v95H45Z" fill="#244c62" opacity=".62" /><path d="m40 248 180-61 156 28 95-43 115 66 181-54 95 34v60H40Z" fill="#163240" /><path d="M450 173v38m-6-30 6-10 6 10m-9 29-4 12m10-12 4 12" stroke="#10212b" strokeWidth="4" strokeLinecap="round" /><circle cx="450" cy="165" r="5" fill="#10212b" /></g><path d="M90 225Q450 251 810 225" fill="none" stroke="#b7dfed" strokeWidth="2" opacity=".65" /></svg><span>SCREEN</span><div className="cinema-screen-reflection" aria-hidden="true" /></div>
}
