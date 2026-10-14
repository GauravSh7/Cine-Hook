import type { Booking, BookingSeat, Movie, Payment, PaymentReconciliation, Refund, RefundAttempt, Seat } from '../../generated/prisma/client.js';
import type { ShowDetail, ShowQuery } from '../shows/show.types.js';
import type { MovieQuery, Page } from '../catalog/catalog.types.js';
import type { UiReadService } from './ui-read.service.js';
import type { EventBookingSeat, EventSeat, EventSection, EventSession, Event, EventVenue, City } from '../../generated/prisma/client.js';

export type BookingReadQuery = Page & { search?: string };
export type UiBookingSeatRecord = Pick<BookingSeat, 'id' | 'showId' | 'seatId' | 'price'> & {
  seat: Pick<Seat, 'rowName' | 'seatNumber' | 'seatType'>;
};
export type UiEventSeatRecord = Pick<EventBookingSeat, 'id' | 'eventSessionId' | 'eventSeatId' | 'price'> & {
  seat: Pick<EventSeat, 'rowName' | 'seatNumber' | 'ticketTier' | 'sectionId'> & { section: Pick<EventSection, 'code' | 'name'> };
};
export type UiEventSessionRecord = EventSession & {
  event: Pick<Event, 'id' | 'title' | 'description' | 'kind' | 'sport' | 'imageUrl' | 'imageAttribution' | 'isSample'>;
  venue: Pick<EventVenue, 'id' | 'name' | 'address' | 'kind' | 'cityId'> & { city: Pick<City, 'id' | 'name' | 'state' | 'countryCode'> };
};
export type UiRefundRecord = Pick<Refund, 'id' | 'providerPaymentId' | 'amountPaise' | 'currency' | 'reason' | 'status'> & {
  attempts: Pick<RefundAttempt, 'id' | 'sequence' | 'providerRefundId' | 'status' | 'lastErrorCode' | 'processedAt'>[];
};
export type UiPaymentRecord = Pick<Payment, 'id' | 'bookingId' | 'amountPaise' | 'currency' | 'status' | 'providerOrderId' |
  'providerPaymentId' | 'capturedAt' | 'bookingFinalizedAt' | 'failureCode' | 'createdAt'> & {
  reconciliation: Pick<PaymentReconciliation, 'reason' | 'compensationRequired' | 'resolvedAt'> | null;
};
export type UiBookingRecord = Pick<Booking, 'id' | 'showId' | 'status' | 'totalPaise' | 'expiresAt' | 'confirmedAt' |
  'failureCode' | 'createdAt' | 'updatedAt'> & {
  bookingKind?: Booking['bookingKind']; eventSessionId?: string | null;
  eventSeats?: UiEventSeatRecord[]; eventSession?: UiEventSessionRecord | null;
  seats: UiBookingSeatRecord[]; show: ShowDetail | null;
  payment: (UiPaymentRecord & { refunds: UiRefundRecord[] }) | null;
};
export type AdminBookingRecord = Pick<UiBookingRecord, 'id' | 'status' | 'totalPaise' | 'expiresAt' | 'createdAt' | 'seats'> & {
  bookingKind?: Booking['bookingKind']; eventSessionId?: string | null;
  eventSeats?: UiEventSeatRecord[]; eventSession?: UiEventSessionRecord | null;
  user: { id: string; name: string };
  show: { id: string; startsAt: Date; movie: { id: string; title: string };
    screen: { id: string; name: string; theatre: { id: string; name: string } } } | null;
  payment: Pick<Payment, 'id' | 'status' | 'amountPaise'> | null;
};
export type AdminPaymentRecord = UiPaymentRecord & {
  booking: { id: string; status: Booking['status']; user: { id: string; name: string } };
  refunds: Pick<Refund, 'id' | 'status' | 'amountPaise' | 'providerPaymentId'>[];
};
export type DashboardRecord = { totalMovies: bigint; activeShows: bigint; bookingsToday: bigint; capturedTodayPaise: bigint };
export interface UiReadStore {
  bookingSummary(owner: string, id: string): Promise<UiBookingRecord | null>;
  dashboard(): Promise<DashboardRecord>;
  movies(query: MovieQuery): Promise<Movie[]>;
  shows(query: ShowQuery): Promise<ShowDetail[]>;
  bookings(query: BookingReadQuery): Promise<AdminBookingRecord[]>;
  payments(query: Page): Promise<AdminPaymentRecord[]>;
}
export interface UiReadServices { reads: UiReadService }
