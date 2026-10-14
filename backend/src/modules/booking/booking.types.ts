import type { Booking, BookingSeat, Seat } from '../../generated/prisma/client.js';
import type { Page } from '../catalog/catalog.types.js';
import type { ShowDetail } from '../shows/show.types.js';
import type { BookingService } from './booking.service.js';
import type { EventBookingStore } from '../event-booking/event-booking.types.js';
import type { BookingGateway } from './booking-gateway.js';

export type BookingInput = { showId: string; seatIds: string[] };
export type BookingRecord = Omit<Booking, 'showId' | 'bookingKind' | 'eventSessionId'> & { showId: string; bookingKind?: 'MOVIE'; eventSessionId?: null; seats: (BookingSeat & { seat: Seat })[] };
export type BookingContext = { show: ShowDetail | null; seats: Seat[]; allocatedSeatIds: string[]; now: Date };
export type PendingInput = BookingInput & { id: string; userId: string; expiresAt: Date };
export type PreparedBooking = { totalPaise: bigint; seats: { seatId: string; price: number }[] };
export type TransitionContext = BookingContext & { booking: BookingRecord };
export type BookingDecision = { status?: 'CONFIRMED' | 'FAILED' | 'CANCELLED'; failureCode?: string };

export interface BookingStore {
  context(showId: string, seatIds?: string[]): Promise<BookingContext>;
  createPending(input: PendingInput, prepare: (context: BookingContext) => Promise<PreparedBooking>): Promise<BookingRecord>;
  transition(id: string, decide: (context: TransitionContext) => Promise<BookingDecision>): Promise<BookingRecord | null>;
  findById(id: string): Promise<BookingRecord | null>;
  listByUser(userId: string, page: Page): Promise<BookingRecord[]>;
  failPending(id: string, failureCode: string): Promise<BookingRecord | null>;
  expirePendingForUser(userId: string): Promise<void>;
}
export interface BookingServices { bookings: BookingService | BookingGateway }

// Repository-owned transaction capability, not a Prisma/HTTP object in a service.
// A caller running the outer transaction executes queued cleanup only on commit.
export interface BookingConfirmationScope {
  store: BookingStore;
  eventStore?: EventBookingStore;
  target?(id: string): Promise<'MOVIE' | 'EVENT' | null>;
  afterCommit(callback: () => Promise<void>): void;
}
