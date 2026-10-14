import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { Page } from '../catalog/catalog.types.js';
import type { BookingContext, BookingDecision, BookingRecord, BookingStore, PendingInput, PreparedBooking, TransitionContext } from './booking.types.js';
import { bookingWrite } from './booking-write.js';
import { releaseUnpaidOffer } from '../pricing/release-unpaid-offer.js';
import {settleExpiredCheckout} from './expired-checkout.js';

const include = { seats: { include: { seat: true }, orderBy: { seatId: 'asc' as const } } } as const;
const showInclude = { movie: true, prices: true, screen: { include: { theatre: { include: { city: true } } } } } as const;
const options = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 7000 };
function movieRecord(value: Prisma.BookingGetPayload<{ include: typeof include }> | null): BookingRecord | null {
  if (!value || value.bookingKind !== 'MOVIE' || !value.showId || value.eventSessionId !== null) return null;
  return { ...value, bookingKind: 'MOVIE', showId: value.showId, eventSessionId: null };
}

export class BookingRepository implements BookingStore {
  constructor(private readonly prisma: PrismaClient, private readonly transaction?: Prisma.TransactionClient) {}

  withTransaction(transaction: Prisma.TransactionClient) { return new BookingRepository(this.prisma, transaction); }

  private run<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.transaction ? work(this.transaction) : this.prisma.$transaction(work, options);
  }

  private async readContext(tx: Prisma.TransactionClient, showId: string, seatIds?: string[]): Promise<BookingContext> {
    const show = await tx.show.findUnique({ where: { id: showId }, include: showInclude });
    const seats = show ? await tx.seat.findMany({ where: { screenId: show.screenId, id: seatIds ? { in: seatIds } : undefined },
      orderBy: [{ rowName: 'asc' }, { seatNumber: 'asc' }] }) : [];
    const allocated = await tx.confirmedSeat.findMany({ where: { showId, seatId: seatIds ? { in: seatIds } : undefined }, select: { seatId: true } });
    // Numeric epoch avoids raw-query timestamp decoding depending on the
    // database session timezone. Redis TIME and SQL expiry use this same epoch.
    const clock = await tx.$queryRaw<{ epochMs: bigint }[]>(Prisma.sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "epochMs"`);
    return { show, seats, allocatedSeatIds: allocated.map(item => item.seatId), now: new Date(Number(clock[0]!.epochMs)) };
  }

  private async lockParents(tx: Prisma.TransactionClient, showId: string, seatIds: string[]) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM shows WHERE id = ${showId}::uuid FOR SHARE`);
    const show = await tx.show.findUnique({ where: { id: showId }, select: { movieId: true } });
    if (show) await tx.$queryRaw(Prisma.sql`SELECT id FROM movies WHERE id = ${show.movieId}::uuid FOR SHARE`);
    if (seatIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM seats WHERE id IN (${Prisma.join(seatIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
  }

  context(showId: string, seatIds?: string[]) { return this.run(tx => this.readContext(tx, showId, seatIds)); }

  createPending(input: PendingInput, prepare: (context: BookingContext) => Promise<PreparedBooking>) {
    return bookingWrite(() => this.run(async tx => {
      await this.lockParents(tx, input.showId, input.seatIds);
      const snapshot = await prepare(await this.readContext(tx, input.showId, input.seatIds));
      return movieRecord(await tx.booking.create({ data: { id: input.id, userId: input.userId, showId: input.showId, expiresAt: input.expiresAt,
        pricingVersion: 1, totalPaise: snapshot.totalPaise, seats: { create: snapshot.seats.map(seat => ({ seatId: seat.seatId, price: seat.price })) },
      }, include }))!;
    }));
  }

  transition(id: string, decide: (context: TransitionContext) => Promise<BookingDecision>) {
    return bookingWrite(() => this.run(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id = ${id}::uuid FOR UPDATE`);
      const booking = movieRecord(await tx.booking.findUnique({ where: { id }, include }));
      if (!booking) return null;
      await this.lockParents(tx, booking.showId, booking.seats.map(item => item.seatId));
      const context = await this.readContext(tx, booking.showId, booking.seats.map(item => item.seatId));
      const decision = await decide({ ...context, booking });
      if (!decision.status || decision.status === booking.status) return booking;
      const result = movieRecord(await tx.booking.update({ where: { id }, data: { status: decision.status, failureCode: decision.failureCode ?? null }, include }));
      if (decision.status === 'CANCELLED' || decision.status === 'FAILED') await releaseUnpaidOffer(tx, booking.userId, id);
      return result;
    }));
  }

  async findById(id: string) { return movieRecord(await (this.transaction ?? this.prisma).booking.findUnique({ where: { id }, include })); }
  async listByUser(userId: string, page: Page) {
    return (await (this.transaction ?? this.prisma).booking.findMany({ where: { userId, bookingKind: 'MOVIE' }, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page.page - 1) * page.limit, take: page.limit })).map(value => movieRecord(value)!);
  }

  failPending(id: string, failureCode: string) {
    return bookingWrite(() => this.run(async tx => {
      await tx.$executeRaw(Prisma.sql`UPDATE bookings SET status = 'FAILED', failure_code = ${failureCode}, updated_at = clock_timestamp()
        WHERE id = ${id}::uuid AND booking_kind='MOVIE' AND status = 'PENDING'`);
      return movieRecord(await tx.booking.findUnique({ where: { id }, include }));
    }));
  }

  async expirePendingForUser(userId: string) {
    await bookingWrite(() => this.run(async tx => {
      const expired=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`UPDATE bookings SET status = 'CANCELLED', failure_code = 'HOLD_EXPIRED', updated_at = clock_timestamp()
        WHERE user_id = ${userId}::uuid AND booking_kind='MOVIE' AND status = 'PENDING' AND expires_at <= clock_timestamp() RETURNING id`);
      for(const booking of expired)await settleExpiredCheckout(this.prisma,tx,userId,booking.id);
    }));
  }
}
