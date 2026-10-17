import { randomUUID } from 'node:crypto';
import { AppError } from '../../errors/app-error.js';
import type { Page } from '../catalog/catalog.types.js';
import type { SeatLocks } from '../seat-lock/seat-lock.types.js';
import type { BookingConfirmationScope } from '../booking/booking.types.js';
import type { EventBookingContext, EventBookingInput, EventBookingRecord, EventBookingStore, PreparedEventBooking } from './event-booking.types.js';
import { confirmedCancellationAllowed } from '../booking/cancellation-policy.js';

function publicBooking(booking: EventBookingRecord) {
  const totalPaise = Number(booking.totalPaise);
  if (!Number.isSafeInteger(totalPaise)) throw new AppError(500, 'INTERNAL_ERROR', 'Unable to read booking.');
  return { id: booking.id, bookingKind: 'EVENT' as const, showId: null, eventSessionId: booking.eventSessionId, status: booking.status, totalPaise,
    expiresAt: booking.expiresAt, confirmedAt: booking.confirmedAt, failureCode: booking.failureCode,
    createdAt: booking.createdAt, updatedAt: booking.updatedAt,
    seats: booking.eventSeats.map(item => ({ id: item.id, eventSessionId: item.eventSessionId, seatId: item.eventSeatId, sectionId: item.seat.sectionId, sectionCode: item.seat.section.code, sectionName: item.seat.section.name,
      rowName: item.seat.rowName, seatNumber: item.seat.seatNumber, ticketTier: item.seat.ticketTier, pricePaise: item.price })) };
}
const missing = () => new AppError(404, 'NOT_FOUND', 'Booking not found.');

export class EventBookingService {
  constructor(private readonly bookings: EventBookingStore, private readonly locks: SeatLocks,
    private readonly newId: () => string = randomUUID) {}

  private quote(context: EventBookingContext, seatIds: string[]): PreparedEventBooking {
    const { session, seats, now } = context;
    if (!session || session.status !== 'SCHEDULED' || !session.event.isActive) throw new AppError(404, 'EVENT_SESSION_NOT_FOUND', 'Event session not found.');
    if (session.startsAt <= now) throw new AppError(409, 'EVENT_SESSION_CLOSED', 'Booking is closed for this event session.');
    if (!seatIds.length || seatIds.length > 10 || new Set(seatIds).size !== seatIds.length || seats.length !== seatIds.length
      || seats.some(seat => !seatIds.includes(seat.id) || seat.section.venueId !== session.venueId)) {
      throw new AppError(400, 'INVALID_SEATS', 'Select distinct physical seats from this event session.');
    }
    if (context.allocatedSeatIds.length) throw new AppError(409, 'SEAT_BOOKED', 'One or more selected seats are already booked.');
    const prices = new Map(session.prices.map(price => [price.ticketTier, price.pricePaise]));
    let totalPaise = 0n;
    const snapshot = seats.map(seat => {
      const price = prices.get(seat.ticketTier);
      if (price === undefined || !Number.isInteger(price) || price <= 0 || price > 2147483647) {
        throw new AppError(409, 'PRICE_COVERAGE', 'Event pricing is unavailable.');
      }
      totalPaise += BigInt(price);
      return { seatId: seat.id, price };
    });
    return { seats: snapshot, totalPaise };
  }

  private async cleanup(booking: Pick<EventBookingRecord, 'id' | 'userId' | 'eventSessionId'>, seatIds: string[]) {
    try { await this.locks.release(booking.eventSessionId, seatIds, booking.userId, booking.id); }
    catch { console.warn(JSON.stringify({ event: 'seat_lock_cleanup_deferred' })); }
  }

  async create(userId: string, input: EventBookingInput) {
    const request = { eventSessionId: input.eventSessionId.toLowerCase(), seatIds: input.seatIds.map(id => id.toLowerCase()) };
    this.quote(await this.bookings.context(request.eventSessionId, request.seatIds), request.seatIds);
    const id = this.newId();
    const identity = { id, userId: userId.toLowerCase(), eventSessionId: request.eventSessionId };
    try {
      const grant = await this.locks.acquire(request.eventSessionId, request.seatIds, identity.userId, id);
      const booking = await this.bookings.createPending({ ...request, ...identity, expiresAt: grant.expiresAt }, async context => {
        const snapshot = this.quote(context, request.seatIds);
        if (grant.expiresAt <= context.now || !await this.locks.validate(request.eventSessionId, request.seatIds, identity.userId, id)) {
          throw new AppError(409, 'HOLD_EXPIRED', 'The seat hold is no longer valid.');
        }
        return snapshot;
      });
      return publicBooking(booking);
    } catch (error) {
      // Acquire timeout can be an unknown Redis outcome. Fenced cleanup runs
      // even if no grant returned, never retrying or deleting another hold.
      // Serialize recovery with any trusted confirmation before removing its
      // hold: the creation transaction may have committed despite a lost ack.
      try { await this.bookings.failPending(id, 'CREATION_FAILED'); }
      catch { console.warn(JSON.stringify({ event: 'booking_recovery_deferred' })); }
      await this.cleanup(identity, request.seatIds);
      throw error;
    }
  }

  private async observe(booking: EventBookingRecord) {
    if (booking.status === 'PENDING' && !await this.locks.validate(booking.eventSessionId, booking.eventSeats.map(item => item.eventSeatId), booking.userId, booking.id)) {
      return await this.bookings.failPending(booking.id, 'HOLD_LOST') ?? booking;
    }
    return booking;
  }

  async getById(userId: string, id: string) {
    await this.bookings.expirePendingForUser(userId.toLowerCase());
    const booking = await this.bookings.findById(id);
    if (!booking || booking.userId !== userId.toLowerCase()) throw missing();
    return publicBooking(await this.observe(booking));
  }

  async payable(userId: string, id: string) {
    const booking = await this.getById(userId, id);
    if (booking.status !== 'PENDING') throw new AppError(409, 'BOOKING_STATE', 'This booking cannot start a payment.');
    const context = await this.bookings.context(booking.eventSessionId, booking.seats.map(seat => seat.seatId));
    if (!context.session || context.session.status !== 'SCHEDULED' || !context.session.event.isActive || context.session.startsAt <= context.now) {
      throw new AppError(409, 'EVENT_SESSION_CLOSED', 'Booking is closed for this event session.');
    }
    return booking;
  }

  async list(userId: string, page: Page) {
    await this.bookings.expirePendingForUser(userId.toLowerCase());
    const bookings = await this.bookings.listByUser(userId.toLowerCase(), page);
    const items = [];
    for (const booking of bookings) items.push(publicBooking(await this.observe(booking)));
    return { items, page: page.page, limit: page.limit };
  }

  async releaseHold(userId: string, id: string) {
    const booking = await this.bookings.transition(id, async context => {
      if (context.booking.userId !== userId.toLowerCase()) throw missing();
      if (context.booking.status === 'CONFIRMED') {
        throw new AppError(409, 'BOOKING_STATE', 'Only an unpaid pending hold can be released here.');
      }
      return context.booking.status === 'PENDING' ? { status: 'CANCELLED', failureCode: 'CHECKOUT_CANCELLED' } : {};
    });
    if (!booking) throw missing();
    await this.cleanup(booking, booking.eventSeats.map(item => item.eventSeatId));
    return publicBooking(booking);
  }

  // Trusted future PaymentService entry point only. No route exposes this method.
  async confirm(id: string, scope?: BookingConfirmationScope) {
    if (scope && !scope.eventStore) throw new AppError(500, 'INTERNAL_ERROR', 'Event transaction scope is unavailable.');
    let booking: EventBookingRecord | null;
    try {
      booking = await (scope?.eventStore ?? this.bookings).transition(id, async context => {
        if (context.booking.status !== 'PENDING') return {};
        if (context.booking.expiresAt <= context.now) return { status: 'FAILED', failureCode: 'HOLD_EXPIRED' };
        if (!context.session || context.session.status !== 'SCHEDULED' || !context.session.event.isActive || context.session.startsAt <= context.now) {
          return { status: 'FAILED', failureCode: 'EVENT_SESSION_CLOSED' };
        }
        const held = await this.locks.validate(context.booking.eventSessionId, context.booking.eventSeats.map(item => item.eventSeatId), context.booking.userId, context.booking.id);
        return held ? { status: 'CONFIRMED' } : { status: 'FAILED', failureCode: 'HOLD_LOST' };
      });
    } catch (error) {
      // The outer Payment repository owns rollback/recovery when scoped.
      // Never release Redis or start a separate transaction before it commits.
      if (scope) throw error;
      // A transaction/network failure might have committed. Never overwrite a
      // concurrent CONFIRMED record; recover it if PostgreSQL can establish it.
      try {
        const recovered = await this.bookings.failPending(id, 'CONFIRMATION_FAILED');
        if (recovered) {
          await this.cleanup(recovered, recovered.eventSeats.map(item => item.eventSeatId));
          if (recovered.status === 'CONFIRMED') return publicBooking(recovered);
        }
      } catch { console.warn(JSON.stringify({ event: 'booking_recovery_deferred' })); }
      throw error;
    }
    if (!booking) throw missing();
    if (scope) {
      const result = booking;
      scope.afterCommit(() => this.cleanup(result, result.eventSeats.map(item => item.eventSeatId)));
      return publicBooking(result);
    }
    await this.cleanup(booking, booking.eventSeats.map(item => item.eventSeatId));
    if (booking.status !== 'CONFIRMED') throw new AppError(409, booking.failureCode ?? 'BOOKING_STATE', 'The booking cannot be confirmed.');
    return publicBooking(booking);
  }

  // Trusted Payment recovery only; conditional failure cannot demote CONFIRMED.
  async failUnfulfilled(id: string, reason: string, scope: BookingConfirmationScope) {
    const booking = await scope.eventStore!.failPending(id, reason);
    if (!booking) throw missing();
    scope.afterCommit(() => this.cleanup(booking, booking.eventSeats.map(seat => seat.eventSeatId)));
    return publicBooking(booking);
  }

  // Trusted cancellation coordinator supplies the shared financial transaction.
  // Permanent cancellation never depends on Redis or deletes quote history.
  async cancel(userId: string, id: string, scope: BookingConfirmationScope) {
    const booking = await scope.eventStore!.transition(id.toLowerCase(), async context => {
      if (context.booking.userId !== userId.toLowerCase()) throw missing();
      if (context.booking.status === 'CANCELLED') return {};
      if (context.booking.status === 'PENDING') return {status:'CANCELLED',failureCode:'CHECKOUT_CANCELLED'};
      if (context.booking.status !== 'CONFIRMED') throw new AppError(409, 'BOOKING_STATE', 'Only a confirmed booking can be cancelled here.');
      if (!context.session || !confirmedCancellationAllowed(context.booking.createdAt, context.session.startsAt, context.now)) {
        throw new AppError(409, 'CANCELLATION_CLOSED', 'Cancellation is available for less than 24 hours after the original booking, before the session starts and never on the session date in Asia/Kolkata.');
      }
      return { status: 'CANCELLED' };
    });
    if (!booking) throw missing();
    scope.afterCommit(()=>this.cleanup(booking,booking.eventSeats.map(seat=>seat.eventSeatId)));
    return publicBooking(booking);
  }

  async availability(eventSessionId: string) {
    let context = await this.bookings.context(eventSessionId.toLowerCase());
    if (!context.session || context.session.status !== 'SCHEDULED' || !context.session.event.isActive) throw new AppError(404, 'EVENT_SESSION_NOT_FOUND', 'Event session not found.');
    if (context.session.startsAt <= context.now) throw new AppError(409, 'EVENT_SESSION_CLOSED', 'Booking is closed for this event session.');
    // A initially confirmed seat may be cancelled and re-held before this
    // inspection. Inspect every physical seat, then read allocation last.
    const holds = await this.locks.inspect(context.session.id, context.seats.map(seat => seat.id));
    // Confirmation may commit and remove its Redis hold during inspection.
    // Read durable allocation last so that cleanup cannot look like a free seat.
    context = await this.bookings.context(context.session.id);
    if (!context.session || context.session.status !== 'SCHEDULED' || !context.session.event.isActive) throw new AppError(404, 'EVENT_SESSION_NOT_FOUND', 'Event session not found.');
    if (context.session.startsAt <= context.now) throw new AppError(409, 'EVENT_SESSION_CLOSED', 'Booking is closed for this event session.');
    const allocated = new Set(context.allocatedSeatIds);
    const prices = new Map(context.session.prices.map(price => [price.ticketTier, price.pricePaise]));
    return { eventSessionId: context.session.id, seats: context.seats.map(seat => {
      const pricePaise = prices.get(seat.ticketTier);
      if (pricePaise === undefined) throw new AppError(409, 'PRICE_COVERAGE', 'Event pricing is unavailable.');
      const hold = holds.get(seat.id);
      return { ...seat, pricePaise, availability: allocated.has(seat.id) ? 'BOOKED' : hold?.locked ? 'LOCKED' : 'AVAILABLE',
        remainingHoldMs: !allocated.has(seat.id) && hold?.locked ? hold.remainingMs : 0 };
    }) };
  }
}
