import type { AdminBooking, Booking, BookingSummary, EventBookingSummary } from '../api/types'
import type { EventSeatQuote } from '../api/event-types'
import {publicVenueLabel} from './customer-copy'

export function isEventSummary(summary: BookingSummary): summary is EventBookingSummary { return summary.booking.bookingKind === 'EVENT' }
export function bookingTitle(summary: BookingSummary): string { return isEventSummary(summary) ? summary.eventSession.event.title : summary.show.movie.title }
export function bookingStartsAt(summary: BookingSummary): string { return isEventSummary(summary) ? summary.eventSession.startsAt : summary.show.startsAt }
export function bookingVenue(summary: BookingSummary): string { return isEventSummary(summary) ? `${publicVenueLabel(summary.eventSession.venue.name)}, ${summary.eventSession.venue.city.name}` : `${publicVenueLabel(summary.show.screen.theatre.name)}, ${summary.show.screen.theatre.city.name}` }
export function seatLabel(seat: { rowName: string; seatNumber: number } & Partial<Pick<EventSeatQuote, 'sectionName' | 'sectionCode'>>): string { return `${seat.sectionName ?? seat.sectionCode ?? ''}${seat.sectionName || seat.sectionCode ? ' ' : ''}${seat.rowName}${seat.seatNumber}` }
export function bookingSeatLabels(booking: Booking): string { return booking.seats.map(seatLabel).join(', ') }
export function adminBookingTitle(booking: AdminBooking): string { return booking.bookingKind === 'EVENT' ? booking.eventSession.event.title : booking.show.movie.title }
export function adminBookingStartsAt(booking: AdminBooking): string { return booking.bookingKind === 'EVENT' ? booking.eventSession.startsAt : booking.show.startsAt }

export function confirmedCancellationAllowed(createdAt: string, startsAt: string, now = Date.now()): boolean {
  const bookedAt = Date.parse(createdAt), starts = Date.parse(startsAt), age = now - bookedAt;
  if (!Number.isFinite(bookedAt) || !Number.isFinite(starts) || !Number.isFinite(now) || age < 0 || age >= 24 * 60 * 60 * 1000 || starts <= now) return false;
  const date = (value: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  return date(now) !== date(starts);
}
