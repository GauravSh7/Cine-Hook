import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { bookingApi } from '../api/booking'
import type { Booking, BookingSummary } from '../api/types'
import { useSession } from '../app/session-context'
import { usePagedAsync } from '../app/use-paged-async'
import { ScrollMore } from '../components/ScrollMore'
import { EmptyState, ErrorState, Loading, StatusBadge } from '../components/feedback'
import { formatDateTime, money, remainingHoldMs } from '../domain/time'
import { AccountLayout } from '../components/AccountLayout'
import { Poster } from '../components/MovieCard'
import { bookingState } from '../domain/booking-state'
import { bookingSeatLabels, bookingStartsAt, bookingTitle, bookingVenue, confirmedCancellationAllowed, isEventSummary } from '../domain/booking-target'
import { EventArtwork } from '../components/EventArtwork'
import { useCountdown } from '../app/use-countdown'

interface Entry { booking: Booking; detail?: BookingSummary }
function BookingCard({ booking, detail }: Entry) {
  const current = detail?.booking ?? booking
  const confirmed = !!detail && current.status === 'CONFIRMED'
  const cancellationUntil = new Date(Date.parse(current.createdAt) + 24 * 60 * 60 * 1000).toISOString()
  const cancellationTimeRemaining = useCountdown(cancellationUntil) > 0
  const cancelAllowed = confirmed && !!detail && cancellationTimeRemaining && confirmedCancellationAllowed(current.createdAt, bookingStartsAt(detail))
  const pending = !!detail && current.status === 'PENDING' && bookingState(current, detail.payment) === 'pending' && remainingHoldMs(current.expiresAt) > 0
  return <article className="panel booking-history-card">{detail && (isEventSummary(detail) ? <EventArtwork event={detail.eventSession.event} className="booking-poster"/> : <Poster movie={detail.show.movie} className="booking-poster"/>)}<div className="booking-history-copy"><h2>{detail ? bookingTitle(detail) : 'Booking details'}</h2><span className="booking-type">{current.bookingKind === 'EVENT' ? 'Event' : 'Movie'}</span>
    {detail && <><p className="muted mt-2 text-sm">{bookingVenue(detail)}{!isEventSummary(detail) && ` · ${detail.show.screen.name}`}</p><p className="muted mt-2 text-sm">{formatDateTime(bookingStartsAt(detail))}</p><p className="muted mt-2 text-sm">Seats: {bookingSeatLabels(current)}</p></>}
    {!detail && <p className="muted mt-2 text-sm">Details unavailable. Open this booking to retry.</p>}
  </div><div className="booking-history-actions"><StatusBadge value={current.status}/><p className="muted mt-3 text-xs">Booking ID</p><p className="mt-1 break-all text-xs">{booking.id}</p><p className="mt-3 text-lg font-semibold">{money(detail?.payment?.amountPaise ?? current.totalPaise)}</p>{detail?.payment && <StatusBadge value={detail.payment.status}/>}<div className="flex flex-wrap gap-2 mt-4"><Link className={confirmed ? 'btn' : 'secondary'} to={`/bookings/${booking.id}`}>{confirmed ? 'View ticket' : 'View status / refund'}</Link>
    {pending && <Link className="btn" to={`/bookings/${booking.id}/checkout`}>Resume checkout</Link>}
    {confirmed && cancelAllowed && <Link className="danger-outline" to={`/bookings/${booking.id}`}>Manage / cancel</Link>}</div></div></article>
}
const tabs = ['All', 'Upcoming', 'Past', 'Cancelled', 'Refunds']
function matches(entry: Entry, tab: string) {
  if (tab === 'All') return true
  if (tab === 'Cancelled') return (entry.detail?.booking ?? entry.booking).status === 'CANCELLED'
  if (!entry.detail) return false
  const { booking, payment } = entry.detail
  if (tab === 'Refunds') return payment?.status === 'REFUND_PENDING' || payment?.status === 'REFUNDED' || entry.detail.refunds.length > 0
  if (booking.status !== 'CONFIRMED' && booking.status !== 'PENDING') return false
  const starts = Date.parse(bookingStartsAt(entry.detail))
  return tab === 'Upcoming' ? starts > Date.now() : tab === 'Past' && starts <= Date.now()
}
export function BookingsPage() {
  const session = useSession(), [page, setPage] = useState(1), [tab, setTab] = useState('All')
  const load = useCallback(async (signal: AbortSignal) => {
    const list = await bookingApi.list({ page }, signal)
    const entries = await Promise.all(list.items.map(async booking => {
      try { return { booking, detail: await bookingApi.summary(booking.id, signal) } } catch { return { booking } }
    }))
    return { ...list, items: entries }
  }, [page])
  const resource = usePagedAsync(`history:${session.token}:${session.user!.id}`, load, page)
  const entries = resource.data?.items ?? [], filtered = entries.filter(entry => matches(entry, tab))
  return <AccountLayout title="My Bookings" detail="Manage your tickets, check status and view booking details"><div className="bookings-layout"><section><div className="filter-tabs" role="tablist" aria-label="Booking categories">{tabs.map((name, index) => <button role="tab" id={`booking-tab-${index}`} aria-controls="booking-history" aria-selected={tab === name} key={name} className={tab === name ? 'btn' : 'secondary'} onClick={() => setTab(name)}>{name} ({entries.filter(entry => matches(entry, name)).length})</button>)}</div><p className="muted text-xs mb-4">Counts reflect loaded bookings.</p><div id="booking-history" role="tabpanel" aria-labelledby={`booking-tab-${tabs.indexOf(tab)}`} className="space-y-4">{resource.loading ? <Loading label="Loading booking history…"/> : resource.error ? <ErrorState error={resource.error} retry={resource.reload}/> : filtered.length ? filtered.map(entry => <BookingCard key={entry.booking.id} {...entry}/>) : <EmptyState title={entries.length ? 'No bookings in this category' : 'No bookings yet'} detail="Discover a movie and choose your next show."/>}</div><ScrollMore {...resource} next={() => setPage(p => p + 1)} retry={resource.reload}/></section><aside className="panel booking-tips"><h2>☀ Booking Help &amp; Tips</h2><p>View confirmed tickets from the booking details page.</p><p>Resume a pending checkout while its seat hold remains active.</p><p>You can cancel a confirmed booking before your show starts.</p><p>Your payment provider determines refund progress. Check the booking status for updates.</p><Link className="accent" to="/help">Help &amp; Support →</Link></aside></div></AccountLayout>
}
