import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { Page } from '../catalog/catalog.types.js';
import type { BookingDecision } from '../booking/booking.types.js';
import { bookingWrite } from '../booking/booking-write.js';
import { releaseUnpaidOffer } from '../pricing/release-unpaid-offer.js';
import {settleExpiredCheckout} from '../booking/expired-checkout.js';
import type { EventBookingContext, EventBookingRecord, EventBookingStore, EventPendingInput, PreparedEventBooking } from './event-booking.types.js';

const include = { eventSeats: { include: { seat: { include: { section: true } } }, orderBy: { eventSeatId: 'asc' as const } } } as const;
const sessionInclude = { event: { include: { performers: true, participants: true } }, prices: true,
  venue: { include: { city: true, sections: { include: { seats: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } } } satisfies Prisma.EventSessionInclude;
const options = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 7000 };
function record(value: (Prisma.BookingGetPayload<{ include: typeof include }>) | null): EventBookingRecord | null {
  if (!value || value.bookingKind !== 'EVENT' || !value.eventSessionId || value.showId !== null) return null;
  return { ...value, eventSessionId: value.eventSessionId };
}

export class EventBookingRepository implements EventBookingStore {
  constructor(private readonly prisma: PrismaClient, private readonly transaction?: Prisma.TransactionClient) {}
  withTransaction(tx: Prisma.TransactionClient) { return new EventBookingRepository(this.prisma, tx); }
  private run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) { return this.transaction ? work(this.transaction) : this.prisma.$transaction(work, options); }
  private async readContext(tx: Prisma.TransactionClient, sessionId: string, seatIds?: string[]): Promise<EventBookingContext> {
    const session = await tx.eventSession.findUnique({ where: { id: sessionId }, include: sessionInclude });
    const seats = session ? await tx.eventSeat.findMany({ where: { section: { venueId: session.venueId }, id: seatIds ? { in: seatIds } : undefined },
      include: { section: true }, orderBy: [{ section: { sortOrder: 'asc' } }, { sectionId: 'asc' }, { rowName: 'asc' }, { seatNumber: 'asc' }, { id: 'asc' }] }) : [];
    const allocated = await tx.eventConfirmedSeat.findMany({ where: { sessionId, seatId: seatIds ? { in: seatIds } : undefined }, select: { seatId: true } });
    const clock = await tx.$queryRaw<{ epochMs: bigint }[]>(Prisma.sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "epochMs"`);
    return { session, seats, allocatedSeatIds: allocated.map(item => item.seatId), now: new Date(Number(clock[0]!.epochMs)) };
  }
  private async lockParents(tx: Prisma.TransactionClient, sessionId: string, seatIds: string[]) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM event_sessions WHERE id=${sessionId}::uuid FOR SHARE`);
    const session = await tx.eventSession.findUnique({ where: { id: sessionId }, select: { eventId: true, venueId: true } });
    if (session) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM events WHERE id=${session.eventId}::uuid FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM event_venues WHERE id=${session.venueId}::uuid FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM event_sections WHERE venue_id=${session.venueId}::uuid ORDER BY id FOR SHARE`);
    }
    if (seatIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM event_seats WHERE id IN (${Prisma.join(seatIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
  }
  context(sessionId: string, seatIds?: string[]) { return this.run(tx => this.readContext(tx, sessionId, seatIds)); }
  createPending(input: EventPendingInput, prepare: (context: EventBookingContext) => Promise<PreparedEventBooking>) {
    return bookingWrite(() => this.run(async tx => {
      await this.lockParents(tx, input.eventSessionId, input.seatIds);
      const quote = await prepare(await this.readContext(tx, input.eventSessionId, input.seatIds));
      return record(await tx.booking.create({ data: { id: input.id, userId: input.userId, bookingKind: 'EVENT', eventSessionId: input.eventSessionId,
        pricingVersion: 1, totalPaise: quote.totalPaise, expiresAt: input.expiresAt, eventSeats: { create: quote.seats.map(seat => ({ eventSeatId: seat.seatId, price: seat.price })) } }, include }))!;
    }));
  }
  transition(id: string, decide: (context: EventBookingContext & { booking: EventBookingRecord }) => Promise<BookingDecision>) {
    return bookingWrite(() => this.run(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id=${id}::uuid FOR UPDATE`);
      const booking = record(await tx.booking.findUnique({ where: { id }, include }));
      if (!booking) return null;
      await this.lockParents(tx, booking.eventSessionId, booking.eventSeats.map(item => item.eventSeatId));
      const decision = await decide({ ...await this.readContext(tx, booking.eventSessionId, booking.eventSeats.map(item => item.eventSeatId)), booking });
      if (!decision.status || decision.status === booking.status) return booking;
      const result = record(await tx.booking.update({ where: { id }, data: { status: decision.status, failureCode: decision.failureCode ?? null }, include }));
      if (decision.status === 'CANCELLED' || decision.status === 'FAILED') await releaseUnpaidOffer(tx, booking.userId, id);
      return result;
    }));
  }
  async findById(id: string) { return record(await (this.transaction ?? this.prisma).booking.findUnique({ where: { id }, include })); }
  async listByUser(userId: string, page: Page) {
    const values = await (this.transaction ?? this.prisma).booking.findMany({ where: { userId, bookingKind: 'EVENT' }, include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page.page - 1) * page.limit, take: page.limit });
    return values.map(value => record(value)!);
  }
  failPending(id: string, failureCode: string) {
    return bookingWrite(() => this.run(async tx => {
      await tx.$executeRaw(Prisma.sql`UPDATE bookings SET status='FAILED',failure_code=${failureCode},updated_at=clock_timestamp()
        WHERE id=${id}::uuid AND booking_kind='EVENT' AND status='PENDING'`);
      return record(await tx.booking.findUnique({ where: { id }, include }));
    }));
  }
  async expirePendingForUser(userId: string) {
    await bookingWrite(() => this.run(async tx => { const expired=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`UPDATE bookings SET status='CANCELLED',failure_code='HOLD_EXPIRED',updated_at=clock_timestamp()
      WHERE user_id=${userId}::uuid AND booking_kind='EVENT' AND status='PENDING' AND expires_at<=clock_timestamp() RETURNING id`);
      for(const booking of expired)await settleExpiredCheckout(this.prisma,tx,userId,booking.id);
    }));
  }
}
