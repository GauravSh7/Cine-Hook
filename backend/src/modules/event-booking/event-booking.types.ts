import type { Booking, EventBookingSeat, EventSeat, EventSection } from '../../generated/prisma/client.js';
import type { EventSessionDetail } from '../events/event.types.js';
import type { Page } from '../catalog/catalog.types.js';
import type { BookingDecision } from '../booking/booking.types.js';

export type EventBookingInput = { eventSessionId: string; seatIds: string[] };
export type EventBookingRecord = Booking & { eventSessionId: string; eventSeats: (EventBookingSeat & { seat: EventSeat & { section: EventSection } })[] };
export type EventBookingContext = { session: EventSessionDetail | null; seats: (EventSeat & { section: EventSection })[]; allocatedSeatIds: string[]; now: Date };
export type EventPendingInput = EventBookingInput & { id: string; userId: string; expiresAt: Date };
export type PreparedEventBooking = { totalPaise: bigint; seats: { seatId: string; price: number }[] };
export interface EventBookingStore {
  context(sessionId: string, seatIds?: string[]): Promise<EventBookingContext>;
  createPending(input: EventPendingInput, prepare: (context: EventBookingContext) => Promise<PreparedEventBooking>): Promise<EventBookingRecord>;
  transition(id: string, decide: (context: EventBookingContext & { booking: EventBookingRecord }) => Promise<BookingDecision>): Promise<EventBookingRecord | null>;
  findById(id: string): Promise<EventBookingRecord | null>;
  listByUser(userId: string, page: Page): Promise<EventBookingRecord[]>;
  failPending(id: string, failureCode: string): Promise<EventBookingRecord | null>;
  expirePendingForUser(userId: string): Promise<void>;
}
