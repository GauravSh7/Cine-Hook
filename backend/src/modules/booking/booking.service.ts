import { randomUUID } from 'node:crypto';
import { AppError } from '../../errors/app-error.js';
import type { Page } from '../catalog/catalog.types.js';
import type { SeatLocks } from '../seat-lock/seat-lock.types.js';
import type { BookingConfirmationScope, BookingContext, BookingInput, BookingRecord, BookingStore, PreparedBooking } from './booking.types.js';
import { confirmedCancellationAllowed } from './cancellation-policy.js';

function publicBooking(booking: BookingRecord) {
  const totalPaise = Number(booking.totalPaise);
  if (!Number.isSafeInteger(totalPaise)) throw new AppError(500, 'INTERNAL_ERROR', 'Unable to read booking.');
  return { id: booking.id, bookingKind: 'MOVIE' as const, showId: booking.showId, eventSessionId: null, status: booking.status, totalPaise,
    expiresAt: booking.expiresAt, confirmedAt: booking.confirmedAt, failureCode: booking.failureCode,
    createdAt: booking.createdAt, updatedAt: booking.updatedAt,
    seats: booking.seats.map(item => ({ id: item.id, showId: item.showId, seatId: item.seatId,
      rowName: item.seat.rowName, seatNumber: item.seat.seatNumber, seatType: item.seat.seatType, pricePaise: item.price })) };
}
const missing = () => new AppError(404, 'NOT_FOUND', 'Booking not found.');

export class BookingService {
  constructor(private readonly bookings: BookingStore, private readonly locks: SeatLocks,
    private readonly newId: () => string = randomUUID) {}

  private quote(context: BookingContext, seatIds: string[]): PreparedBooking {
    const { show, seats, now } = context;
    if (!show || show.status !== 'SCHEDULED' || !show.movie.isActive) throw new AppError(404, 'NOT_FOUND', 'Show not found.');
    if (show.startsAt <= now) throw new AppError(409, 'SHOW_CLOSED', 'Booking is closed for this show.');
    if (!seatIds.length || seatIds.length > 10 || new Set(seatIds).size !== seatIds.length || seats.length !== seatIds.length
      || seats.some(seat => !seatIds.includes(seat.id) || seat.screenId !== show.screenId)) {
      throw new AppError(400, 'INVALID_SEATS', 'Select distinct physical seats from this show.');
    }
    if (context.allocatedSeatIds.length) throw new AppError(409, 'SEAT_BOOKED', 'One or more selected seats are already booked.');
    const prices = new Map(show.prices.map(price => [price.seatType, price.pricePaise]));
    let totalPaise = 0n;
    const snapshot = seats.map(seat => {
      const price = prices.get(seat.seatType);
      if (price === undefined || !Number.isInteger(price) || price <= 0 || price > 2147483647) {
        throw new AppError(409, 'PRICE_COVERAGE', 'Show pricing is unavailable.');
      }
      totalPaise += BigInt(price);
      return { seatId: seat.id, price };
    });
    return { seats: snapshot, totalPaise };
  }

  private async cleanup(booking: Pick<BookingRecord, 'id' | 'userId' | 'showId'>, seatIds: string[]) {
    try { await this.locks.release(booking.showId, seatIds, booking.userId, booking.id); }
    catch { console.warn(JSON.stringify({ event: 'seat_lock_cleanup_deferred' })); }
  }

  async create(userId: string, input: BookingInput) {
    const request = { showId: input.showId.toLowerCase(), seatIds: input.seatIds.map(id => id.toLowerCase()) };
    this.quote(await this.bookings.context(request.showId, request.seatIds), request.seatIds);
    const id = this.newId();
    const identity = { id, userId: userId.toLowerCase(), showId: request.showId };
    try {
      const grant = await this.locks.acquire(request.showId, request.seatIds, identity.userId, id);
      const booking = await this.bookings.createPending({ ...request, ...identity, expiresAt: grant.expiresAt }, async context => {
        const snapshot = this.quote(context, request.seatIds);
        if (grant.expiresAt <= context.now || !await this.locks.validate(request.showId, request.seatIds, identity.userId, id)) {
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

  private async observe(booking: BookingRecord) {
    if (booking.status === 'PENDING' && !await this.locks.validate(booking.showId, booking.seats.map(item => item.seatId), booking.userId, booking.id)) {
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
    const context = await this.bookings.context(booking.showId, booking.seats.map(seat => seat.seatId));
    if (!context.show || context.show.status !== 'SCHEDULED' || !context.show.movie.isActive || context.show.startsAt <= context.now) {
      throw new AppError(409, 'SHOW_CLOSED', 'Booking is closed for this show.');
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
    // Commit cancellation before releasing Redis, never free an uncommitted hold.
    await this.cleanup(booking, booking.seats.map(item => item.seatId));
    return publicBooking(booking);
  }

  // Trusted future PaymentService entry point only. No route exposes this method.
  async confirm(id: string, scope?: BookingConfirmationScope) {
    let booking: BookingRecord | null;
    try {
      booking = await (scope?.store ?? this.bookings).transition(id, async context => {
        if (context.booking.status !== 'PENDING') return {};
        if (context.booking.expiresAt <= context.now) return { status: 'FAILED', failureCode: 'HOLD_EXPIRED' };
        if (!context.show || context.show.status !== 'SCHEDULED' || !context.show.movie.isActive || context.show.startsAt <= context.now) {
          return { status: 'FAILED', failureCode: 'SHOW_CLOSED' };
        }
        const held = await this.locks.validate(context.booking.showId, context.booking.seats.map(item => item.seatId), context.booking.userId, context.booking.id);
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
          await this.cleanup(recovered, recovered.seats.map(item => item.seatId));
          if (recovered.status === 'CONFIRMED') return publicBooking(recovered);
        }
      } catch { console.warn(JSON.stringify({ event: 'booking_recovery_deferred' })); }
      throw error;
    }
    if (!booking) throw missing();
    if (scope) {
      const result = booking;
      scope.afterCommit(() => this.cleanup(result, result.seats.map(item => item.seatId)));
      return publicBooking(result);
    }
    await this.cleanup(booking, booking.seats.map(item => item.seatId));
    if (booking.status !== 'CONFIRMED') throw new AppError(409, booking.failureCode ?? 'BOOKING_STATE', 'The booking cannot be confirmed.');
    return publicBooking(booking);
  }

  // Trusted Payment recovery only; conditional failure cannot demote CONFIRMED.
  async failUnfulfilled(id: string, reason: string, scope: BookingConfirmationScope) {
    const booking = await scope.store.failPending(id, reason);
    if (!booking) throw missing();
    scope.afterCommit(() => this.cleanup(booking, booking.seats.map(seat => seat.seatId)));
    return publicBooking(booking);
  }

  // Trusted cancellation coordinator supplies the shared financial transaction.
  // Permanent cancellation never depends on Redis or deletes quote history.
  async cancel(userId: string, id: string, scope: BookingConfirmationScope) {
    const booking = await scope.store.transition(id.toLowerCase(), async context => {
      if (context.booking.userId !== userId.toLowerCase()) throw missing();
      if (context.booking.status === 'CANCELLED') return {};
      if (context.booking.status === 'PENDING') return {status:'CANCELLED',failureCode:'CHECKOUT_CANCELLED'};
      if (context.booking.status !== 'CONFIRMED') throw new AppError(409, 'BOOKING_STATE', 'Only a confirmed booking can be cancelled here.');
      if (!context.show || !confirmedCancellationAllowed(context.booking.createdAt, context.show.startsAt, context.now)) {
        throw new AppError(409, 'CANCELLATION_CLOSED', 'Cancellation is available for 24 hours after booking, when the show is on a later day and at least 24 hours away.');
      }
      return { status: 'CANCELLED' };
    });
    if (!booking) throw missing();
    scope.afterCommit(()=>this.cleanup(booking,booking.seats.map(seat=>seat.seatId)));
    return publicBooking(booking);
  }

  async availability(showId: string) {
    let context = await this.bookings.context(showId.toLowerCase());
    if (!context.show || context.show.status !== 'SCHEDULED' || !context.show.movie.isActive) throw new AppError(404, 'NOT_FOUND', 'Show not found.');
    if (context.show.startsAt <= context.now) throw new AppError(409, 'SHOW_CLOSED', 'Booking is closed for this show.');
    // A initially confirmed seat may be cancelled and re-held before this
    // inspection. Inspect every physical seat, then read allocation last.
    const holds = await this.locks.inspect(context.show.id, context.seats.map(seat => seat.id));
    // Confirmation may commit and remove its Redis hold during inspection.
    // Read durable allocation last so that cleanup cannot look like a free seat.
    context = await this.bookings.context(context.show.id);
    if (!context.show || context.show.status !== 'SCHEDULED' || !context.show.movie.isActive) throw new AppError(404, 'NOT_FOUND', 'Show not found.');
    if (context.show.startsAt <= context.now) throw new AppError(409, 'SHOW_CLOSED', 'Booking is closed for this show.');
    const allocated = new Set(context.allocatedSeatIds);
    const prices = new Map(context.show.prices.map(price => [price.seatType, price.pricePaise]));
    return { showId: context.show.id, seats: context.seats.map(seat => {
      const pricePaise = prices.get(seat.seatType);
      if (pricePaise === undefined) throw new AppError(409, 'PRICE_COVERAGE', 'Show pricing is unavailable.');
      const hold = holds.get(seat.id);
      return { ...seat, pricePaise, availability: allocated.has(seat.id) ? 'BOOKED' : hold?.locked ? 'LOCKED' : 'AVAILABLE',
        remainingHoldMs: !allocated.has(seat.id) && hold?.locked ? hold.remainingMs : 0 };
    }) };
  }
}
