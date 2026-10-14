import { expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { bookingFixture } from './helpers/booking.js';
import { SeatLockService } from '../src/modules/seat-lock/seat-lock.service.js';
import { UiReadService } from '../src/modules/ui-read/ui-read.service.js';
import type { UiReadStore } from '../src/modules/ui-read/ui-read.types.js';
import { paymentWrite } from '../src/modules/payments/payment-write.js';
import { bookingWrite } from '../src/modules/booking/booking-write.js';
import { BookingGateway } from '../src/modules/booking/booking-gateway.js';
import { BookingTargetRepository } from '../src/modules/booking/booking-target.repository.js';

it('repository conceals absent and foreign targets and bounds mixed history with only reference identities', async () => {
  const user = randomUUID(), foreign = randomUUID(), id = randomUUID(), movieId = randomUUID();
  const records = new Map([[id, { bookingKind: 'EVENT', userId: user }], [movieId, { bookingKind: 'MOVIE', userId: user }]]);
  const reads: unknown[] = [];
  const prisma = { booking: {
    findUnique: async (query: { where: { id: string } }) => { reads.push(query); return records.get(query.where.id) ?? null; },
    findMany: async (query: unknown) => { reads.push(query); return [{ id }, { id: movieId }]; },
  } };
  const targets = new BookingTargetRepository(prisma as never);
  expect(await targets.findTarget(id, user)).toBe('EVENT');
  expect(await targets.findTarget(movieId, user)).toBe('MOVIE');
  expect(await targets.findTarget(id, foreign)).toBeNull();
  expect(await targets.findTarget(randomUUID(), user)).toBeNull();
  expect(await targets.findTarget(id)).toBe('EVENT');
  expect(reads[0]).toEqual({ where: { id }, select: { bookingKind: true, userId: true } });
  expect(await targets.referencesByUser(user, { page: 3, limit: 2 })).toEqual([{ id }, { id: movieId }]);
  expect(reads.at(-1)).toEqual({ where: { userId: user }, select: { id: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 4, take: 2 });
});

it('routes owned movie and event records through injected target/history repositories with stable mixed pagination', async () => {
  const user = randomUUID(), foreign = randomUUID(), movieId = randomUUID(), eventId = randomUUID();
  const records = new Map([[movieId, { id: movieId, bookingKind: 'MOVIE', owner: user }], [eventId, { id: eventId, bookingKind: 'EVENT', owner: user }]]);
  const reads: unknown[] = [];
  const targets = {
    findTarget: async (id: string, owner?: string) => { reads.push({ id, owner }); const value = records.get(id); return value && (!owner || value.owner === owner) ? value.bookingKind : null; },
    referencesByUser: async (owner: string, page: { page: number; limit: number }) => { reads.push({ owner, page }); return [{ id: eventId }, { id: movieId }]; },
  };
  const domain = (kind: string) => ({ getById: async (_owner: string, id: string) => {
    const record = records.get(id.toLowerCase()); if (record?.bookingKind !== kind) throw new Error('Wrong persisted domain route'); return record;
  } });
  const gateway = new BookingGateway(targets as never, domain('MOVIE') as never, domain('EVENT') as never);
  await expect(gateway.getById(user.toUpperCase(), eventId.toUpperCase())).resolves.toMatchObject({ bookingKind: 'EVENT' });
  await expect(gateway.getById(user, movieId)).resolves.toMatchObject({ bookingKind: 'MOVIE' });
  await expect(gateway.getById(foreign, eventId)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  await expect(gateway.getById(user, randomUUID())).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  expect(await gateway.list(user.toUpperCase(), { page: 3, limit: 2 })).toEqual({ items: [records.get(eventId), records.get(movieId)], page: 3, limit: 2 });
  expect(reads).toContainEqual({ id: eventId, owner: user });
  expect(reads).toContainEqual({ owner: user, page: { page: 3, limit: 2 } });
});

it('financial target selection uses the supplied transaction capability without reading the unscoped repository', async () => {
  const id = randomUUID(), user = randomUUID();
  const targets = { findTarget: async () => { throw new Error('Unscoped target read'); }, referencesByUser: async () => [] };
  const scope = { store: {} as never, target: async (target: string) => {
    if (target !== id) throw new Error('Target was not normalized'); return 'EVENT' as const;
  }, afterCommit: () => {} };
  const events = { confirm: async (_id: string, passed: unknown) => { expect(passed).toBe(scope); return { status: 'CONFIRMED' }; },
    failUnfulfilled: async (_id: string, _reason: string, passed: unknown) => { expect(passed).toBe(scope); return { status: 'FAILED' }; },
    cancel: async (_owner: string, _id: string, passed: unknown) => { expect(passed).toBe(scope); return { status: 'CANCELLED' }; } };
  const gateway = new BookingGateway(targets as never, {} as never, events as never);
  expect(await gateway.confirm(id.toUpperCase(), scope)).toEqual({ status: 'CONFIRMED' });
  expect(await gateway.failUnfulfilled(id, 'TEST_FAILURE', scope)).toEqual({ status: 'FAILED' });
  expect(await gateway.cancel(user, id, scope)).toEqual({ status: 'CANCELLED' });
  await expect(gateway.confirm(id, { ...scope, target: async () => null })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('maps native commit constraint failures to recoverable payment conflicts and allocation collisions without exposing driver errors', async () => {
  const failure = (code: string) => Object.assign(new Error('Private commit diagnostic'), { cause: { originalCode: code } });
  await expect(paymentWrite(async () => { throw failure('23514'); })).rejects.toMatchObject({ status: 409, code: 'PAYMENT_CONFLICT' });
  await expect(paymentWrite(async () => { throw failure('40P01'); })).rejects.toMatchObject({ status: 409, code: 'CONCURRENT_CHANGE' });
  await expect(bookingWrite(async () => { throw failure('23505'); })).rejects.toMatchObject({ status: 409, code: 'SEAT_BOOKED' });
});

it('projects event summaries and admin bookings without requiring a cinema show or losing the seat quote', async () => {
  const id = randomUUID(), sessionId = randomUUID(), seatId = randomUUID(), now = new Date('2030-01-01T00:00:00Z');
  const seat = { id: seatId, eventSessionId: sessionId, eventSeatId: seatId, price: 12300,
    seat: { rowName: 'B', seatNumber: 4, ticketTier: 'VIP', sectionId: randomUUID(), section: { code: 'NORTH', name: 'North' } } };
  const session = { id: sessionId, eventId: randomUUID(), venueId: randomUUID(), startsAt: now, endsAt: now,
    status: 'SCHEDULED', createdAt: now, updatedAt: now, event: { id: randomUUID(), title: 'Stored cricket', kind: 'SPORTS', isSample: true },
    venue: { id: randomUUID(), name: 'Stored arena', kind: 'ARENA', city: { id: randomUUID(), name: 'Delhi' } } };
  const booking = { id, bookingKind: 'EVENT', showId: null, eventSessionId: sessionId, status: 'CONFIRMED', totalPaise: 12300n,
    expiresAt: now, confirmedAt: now, failureCode: null, createdAt: now, updatedAt: now, show: null, eventSession: session,
    seats: [], eventSeats: [seat], payment: null, user: { id: randomUUID(), name: 'Owner' } };
  const store = { bookingSummary: async () => booking, bookings: async () => [booking] } as unknown as UiReadStore;
  const reads = new UiReadService(store, { getById: async () => ({ id }) } as never);
  const summary = await reads.bookingSummary(booking.user.id, id);
  expect(summary.show).toBeNull();
  expect(summary).toMatchObject({ booking: { bookingKind: 'EVENT', eventSessionId: sessionId,
    seats: [{ seatId, ticketTier: 'VIP', sectionCode: 'NORTH', pricePaise: 12300 }] }, eventSession: { id: sessionId, event: { title: 'Stored cricket' } } });
  expect((await reads.bookings({ page: 1, limit: 20 })).items[0]).toMatchObject({ bookingKind: 'EVENT', show: null, eventSession: { id: sessionId },
    seats: [{ rowName: 'B', seatNumber: 4, ticketTier: 'VIP', pricePaise: 12300 }] });
});

it('registers authenticated event holds without accepting financial or target flags', async () => {
  const f = await bookingFixture();
  const response = await request(f.app).post('/api/event-bookings').send({ eventSessionId: randomUUID(), seatIds: [randomUUID()] });
  expect(response.status).toBe(401);
});

it('isolates event holds from movie holds while retaining fenced five minute grants', async () => {
  let command: readonly string[] = [];
  const locks = new SeatLockService({ sendCommand: async args => { command = args; return [1, 1893456300000]; } }, 'event');
  const session = randomUUID(), seat = randomUUID(), owner = randomUUID(), hold = randomUUID();
  expect(await locks.acquire(session, [seat], owner, hold)).toEqual({ expiresAt: new Date('2030-01-01T00:05:00Z') });
  expect(command.slice(2)).toEqual(['1', `cinehook:event-seat-lock:{${session}}:${seat}`, `${owner}:${hold}`, '300000']);
});
