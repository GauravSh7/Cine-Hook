import type { BookingSummary } from '../api/types'
import { Poster } from './MovieCard'
import { StatusBadge } from './feedback'
import { formatDateTime, money } from '../domain/time'
import { bookingSeatLabels, bookingStartsAt, bookingTitle, bookingVenue, isEventSummary } from '../domain/booking-target'
import { EventArtwork } from './EventArtwork'
import {CheckoutSeatPreview} from './CheckoutSeatPreview'
import {publicVenueLabel} from '../domain/customer-copy'

export function BookingFacts({ summary, checkout = false, totalPaise }: { summary: BookingSummary; checkout?: boolean; totalPaise?:number }) {
  const { booking, payment } = summary
  const event = isEventSummary(summary), title = bookingTitle(summary)
  const paid = payment && ['SUCCESS', 'REFUND_PENDING', 'REFUNDED'].includes(payment.status)
  return <section className="panel p-6 sm:p-8">
    {checkout ? <h2 className="text-xl font-semibold">Booking summary</h2> : <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-2xl font-semibold">{title}</h2><StatusBadge value={booking.status} /></div>}
    <div className="mt-6 flex gap-5">{event ? <EventArtwork event={summary.eventSession.event} className="booking-event-art" /> : <Poster movie={summary.show.movie} className="h-28 w-20 shrink-0 rounded-xl" />}<div className="min-w-0">
      {checkout && <h3 className="text-xl font-semibold">{title}</h3>}<p className="muted text-sm capitalize">{event ? `${summary.eventSession.event.kind.toLowerCase()}${summary.eventSession.event.sport ? ` • ${summary.eventSession.event.sport}` : ''}` : `${summary.show.movie.genres.join(' • ')} • ${summary.show.movie.language} • ${summary.show.movie.durationMinutes} min`}</p>
      <p className="mt-2">{bookingVenue(summary)}</p><p className="muted mt-1 text-sm">{event ? 'Reserved numbered seats' : publicVenueLabel(summary.show.screen.name)}</p>
    </div></div><div className="divider" />
    <dl className="grid grid-cols-2 gap-5 md:grid-cols-4"><div><dt className="muted text-xs">{event ? 'Session date / time' : 'Show date / time'}</dt><dd className="mt-1 font-semibold">{formatDateTime(bookingStartsAt(summary))}</dd></div>
      <div><dt className="muted text-xs">Seats</dt><dd className="mt-1 font-semibold">{bookingSeatLabels(booking)}</dd></div>
      <div><dt className="muted text-xs">Tickets</dt><dd className="mt-1 font-semibold">{booking.seats.length}</dd></div><div><dt className="muted text-xs">{checkout ? 'Total payable' : 'Booking amount'}</dt><dd className="mt-1 font-semibold">{checkout ? totalPaise===undefined?'—':money(totalPaise) : money(booking.totalPaise)}</dd></div>
    </dl><div className="divider" />
    {checkout ? (!event && summary.show ? <CheckoutSeatPreview summary={summary as import('../api/types').MovieBookingSummary}/> : null)
      : <dl className="financial-facts"><div><dt>Booking ID</dt><dd>{booking.id}</dd></div>
        <div><dt>Booking status</dt><dd>{booking.status}</dd></div>
        {paid && <div><dt>Amount paid</dt><dd>{money(payment.amountPaise)}</dd></div>}
        <div><dt>Payment ID</dt><dd>{payment?.providerPaymentId ?? 'Not available'}</dd></div>
        <div><dt>Payment status</dt><dd>{payment?.status ?? 'NOT INITIATED'}</dd></div></dl>}
  </section>
}
