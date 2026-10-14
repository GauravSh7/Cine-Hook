import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { bookingFixture } from './helpers/booking.js';
import { createUiRead } from '../src/modules/ui-read/create-ui-read.js';
import { uiReadRoutes } from '../src/modules/ui-read/ui-read.routes.js';

async function setup(role: 'USER' | 'ADMIN' | null = 'ADMIN', tokenRole: 'USER' | 'ADMIN' = 'ADMIN') {
  const fixture = await bookingFixture();
  const held = await fixture.service.create(fixture.userId, { showId: fixture.show.id, seatIds: [fixture.seats[0]!.id] });
  const now = new Date('2030-01-01T00:00:00Z');
  const reconciliation = { id: 'recon-private', paymentId: 'payment-id', reason: 'BOOKING_UNFULFILLED', compensationRequired: true,
    resolvedAt: null, createdAt: now, updatedAt: now };
  const refund = { id: 'refund-id', paymentId: 'payment-id', providerPaymentId: 'pay_primary', amountPaise: 10000n,
    currency: 'INR', reason: 'CANCELLATION', status: 'PENDING', createdAt: now, updatedAt: now,
    attempts: [{ id: 'attempt-id', refundId: 'refund-id', sequence: 1, receipt: 'secret-attempt-receipt',
      providerRefundId: null, status: 'REQUESTED', lastErrorCode: null, processedAt: null, createdAt: now, updatedAt: now }] };
  const payment = { id: 'payment-id', bookingId: held.id, receipt: 'private-receipt', amountPaise: 10000n, currency: 'INR',
    status: 'REFUND_PENDING', providerOrderId: 'order_primary', providerPaymentId: 'pay_primary', capturedAt: now,
    bookingFinalizedAt: now, failureCode: null, createdAt: now, updatedAt: now, reconciliation, refunds: [refund],
    events: [{ digest: 'secret-event-digest' }], evidence: [{ captured: true }], secret: 'private-provider-key' };
  const state = { payment: payment as typeof payment | null, role, locked: false, owner: fixture.userId,
    stats: { totalMovies: 3n, activeShows: 2n, bookingsToday: 4n, capturedTodayPaise: 28000n } };
  const projection = () => ({ ...fixture.records.get(held.id)!, userId: state.owner,
    show: { ...fixture.show, movie: { ...fixture.movie, isActive: false } },
    user: { id: fixture.userId, name: 'Booking user', passwordHash: 'secret-password-hash', email: 'private@example.com' },
    payment: state.payment });
  const findUnique = vi.fn(async () => {
    if (!state.locked) throw new Error('Financial projection read before booking lock');
    return projection();
  });
  const bookingFindMany = vi.fn(async () => [projection()]);
  const paymentFindMany = vi.fn(async () => state.payment ? [{ ...state.payment,
    booking: { id: held.id, status: 'CANCELLED', user: projection().user } }] : []);
  const movieFindMany = vi.fn(async () => [{ ...fixture.movie, isActive: false }]);
  const showFindMany = vi.fn(async () => [{ ...projection().show, status: 'CANCELLED' }]);
  const queryRaw = vi.fn(async (query: Prisma.Sql) => {
    if (query.sql.includes('FOR SHARE')) {
      state.locked = true;
      return [{ id: held.id, userId: state.owner }];
    }
    return [state.stats];
  });
  const tx = { $queryRaw: queryRaw, booking: { findUnique } };
  const transaction = vi.fn(async (work: (db: typeof tx) => Promise<unknown>) => {
    state.locked = false;
    try { return await work(tx); } finally { state.locked = false; }
  });
  const prisma = { $transaction: transaction, $queryRaw: queryRaw, movie: { findMany: movieFindMany },
    show: { findMany: showFindMany }, booking: { findMany: bookingFindMany }, payment: { findMany: paymentFindMany } } as unknown as PrismaClient;
  const reads = createUiRead(prisma, fixture.service);
  const auth = new AuthService({ create: async () => { throw new Error('unused'); }, findByEmail: async () => null,
    findById: async id => state.role ? { id, role: state.role, name: 'Booking user', email: 'test@example.com', createdAt: now, updatedAt: now } : null }, fixture.tokens);
  const app = express();
  app.use('/api', uiReadRoutes(reads, { service: auth, tokens: fixture.tokens }));
  app.use(errorHandler);
  return { ...fixture, app, reads, state, payment, refund, projection, queryRaw, findUnique, transaction,
    bookingFindMany, paymentFindMany, movieFindMany, showFindMany,
    adminToken: fixture.tokens.sign({ userId: fixture.userId, role: tokenRole }) };
}
const adminPaths = ['/api/admin/dashboard', '/api/admin/movies', '/api/admin/shows', '/api/admin/bookings', '/api/admin/payments'];
function get(f: Awaited<ReturnType<typeof setup>>, path: string, token = f.adminToken) {
  return request(f.app).get(path).set('Authorization', `Bearer ${token}`);
}

describe('owner booking summary', () => {
  it('returns historical disabled movie/show, exact immutable quote, public payment and refunds without secrets', async () => {
    const f = await setup('USER');
    const response = await get(f, `/api/bookings/${f.projection().id}/summary`, f.token);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.booking).toEqual({ id: f.projection().id, showId: f.show.id, status: 'PENDING', totalPaise: 10000,
      expiresAt: '2030-01-01T00:05:00.000Z', confirmedAt: null, failureCode: null,
      createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z',
      seats: [{ id: f.projection().seats[0]!.id, showId: f.show.id, seatId: f.seats[0]!.id,
        rowName: 'A', seatNumber: 1, seatType: 'REGULAR', pricePaise: 10000 }] });
    expect(response.body.data.show).toMatchObject({ id: f.show.id, movie: { id: f.movie.id, isActive: false },
      screen: { theatre: { city: { name: 'Booking city' } } },
      prices: [{ seatType: 'REGULAR', pricePaise: 10000 }, { seatType: 'PREMIUM', pricePaise: 15000 }] });
    expect(response.body.data.payment).toEqual({ id: 'payment-id', bookingId: f.projection().id, amountPaise: 10000, currency: 'INR',
      status: 'REFUND_PENDING', providerOrderId: 'order_primary', providerPaymentId: 'pay_primary',
      capturedAt: '2030-01-01T00:00:00.000Z', bookingFinalizedAt: '2030-01-01T00:00:00.000Z', failureCode: null,
      reconciliation: { reason: 'BOOKING_UNFULFILLED', compensationRequired: true, resolvedAt: null } });
    expect(response.body.data.refunds).toEqual([{ id: 'refund-id', providerPaymentId: 'pay_primary', amountPaise: 10000,
      currency: 'INR', reason: 'CANCELLATION', status: 'PENDING', attempts: [{ id: 'attempt-id', sequence: 1,
        providerRefundId: null, status: 'REQUESTED', lastErrorCode: null, processedAt: null }] }]);
    expect(JSON.stringify(response.body)).not.toMatch(/secret|private|passwordHash|receipt|digest|events|evidence/);
    expect(f.transaction.mock.calls[0]?.[1]).toMatchObject({ isolationLevel: 'ReadCommitted' });
  });
  it('observes lost holds before the locked financial projection', async () => {
    const f = await setup('USER'); f.holds.clear();
    const response = await get(f, `/api/bookings/${f.projection().id}/summary`, f.token);
    expect(response.status).toBe(200);
    expect(response.body.data.booking).toMatchObject({ status: 'FAILED', failureCode: 'HOLD_LOST' });
  });
  it('represents a booking without payment as null and empty refunds', async () => {
    const f = await setup('USER'); f.state.payment = null;
    const response = await get(f, `/api/bookings/${f.projection().id}/summary`, f.token);
    expect(response.status).toBe(200);
    expect(response.body.data.payment).toBeNull(); expect(response.body.data.refunds).toEqual([]);
  });
  it('conceals foreign and absent bookings with 404', async () => {
    const f = await setup('USER');
    expect((await get(f, `/api/bookings/${f.projection().id}/summary`, f.otherToken)).status).toBe(404);
    expect((await get(f, '/api/bookings/11111111-1111-4111-8111-111111111111/summary', f.token)).status).toBe(404);
  });
  it('checks ownership again inside the read lock before reading financial data', async () => {
    const f = await setup('USER'); f.state.owner = f.otherUserId;
    expect((await get(f, `/api/bookings/${f.projection().id}/summary`, f.token)).status).toBe(404);
    expect(f.findUnique).not.toHaveBeenCalled();
  });
  it('requires a current existing user', async () => {
    const f = await setup(null);
    expect((await request(f.app).get(`/api/bookings/${f.projection().id}/summary`)).status).toBe(401);
    expect((await get(f, `/api/bookings/${f.projection().id}/summary`, f.token)).status).toBe(401);
  });
  it('rejects malformed booking identifiers', async () => {
    const f = await setup('USER');
    expect((await get(f, '/api/bookings/invalid/summary', f.token)).status).toBe(400);
  });
  it.each(['payment', 'refund'] as const)('fails safely rather than rounding unsafe %s amounts', async field => {
    const f = await setup('USER');
    if (field === 'payment') f.payment.amountPaise = 9007199254740992n;
    else f.refund.amountPaise = 9007199254740992n;
    const response = await get(f, `/api/bookings/${f.projection().id}/summary`, f.token);
    expect(response.status).toBe(500); expect(response.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('current database admin read permissions', () => {
  it.each(adminPaths)('requires authentication for %s', async path => {
    const f = await setup(); expect((await request(f.app).get(path)).status).toBe(401);
  });
  it.each(adminPaths)('denies a revoked ADMIN claim for %s', async path => {
    const f = await setup('USER', 'ADMIN'); expect((await get(f, path)).status).toBe(403);
  });
  it.each(adminPaths)('accepts current ADMIN with old USER claim for %s', async path => {
    const f = await setup('ADMIN', 'USER'); expect((await get(f, path)).status).toBe(200);
  });
  it('denies deleted admins', async () => {
    const f = await setup(null); expect((await get(f, '/api/admin/dashboard')).status).toBe(401);
  });
  it.each(['/api/admin/movies?limit=101', '/api/admin/shows?date=2026-02-30', '/api/admin/bookings?page=0',
    '/api/admin/bookings?search=a&search=b', `/api/admin/bookings?search=${'x'.repeat(101)}`,
    '/api/admin/payments?unknown=x', '/api/admin/dashboard?unknown=x'])('strictly rejects invalid read query %s', async path => {
    const f = await setup(); expect((await get(f, path)).status).toBe(400);
  });
});

describe('global admin projections', () => {
  it('includes disabled movies and historical/cancelled shows with bounded pagination', async () => {
    const f = await setup();
    const movies = await get(f, '/api/admin/movies?page=2&limit=10&search=100%25_&language=ENGLISH&genre=DRAMA');
    expect(movies.status).toBe(200); expect(movies.body.data).toMatchObject({ page: 2, limit: 10, items: [{ isActive: false }] });
    expect(f.movieFindMany.mock.calls[0]?.[0]).toMatchObject({ where: { title: { contains: '100\\%\\_', mode: 'insensitive' }, language: 'english', genres: { has: 'drama' } }, skip: 10, take: 10 });
    expect(f.movieFindMany.mock.calls[0]?.[0].where).not.toHaveProperty('isActive');
    const shows = await get(f, '/api/admin/shows?date=2026-10-07');
    expect(shows.status).toBe(200); expect(shows.body.data.items[0].status).toBe('CANCELLED');
    expect(f.showFindMany.mock.calls[0]?.[0].where.startsAt).toEqual({ gte: new Date('2026-10-07T00:00:00Z'), lt: new Date('2026-10-08T00:00:00Z') });
    expect(f.showFindMany.mock.calls[0]?.[0].where).not.toHaveProperty('status');
    expect(f.showFindMany.mock.calls[0]?.[0].where).not.toHaveProperty('movie');
  });
  it('lists server-wide bookings with a minimal user, seat and payment DTO', async () => {
    const f = await setup();
    const response = await get(f, '/api/admin/bookings?page=2&limit=3&search=100%25_');
    expect(response.status).toBe(200);
    expect(response.body.data.items[0]).toEqual({ id: f.projection().id, user: { id: f.userId, name: 'Booking user' },
      show: { id: f.show.id, startsAt: '2099-01-01T10:00:00.000Z', movie: { id: f.movie.id, title: 'Booking movie' },
        screen: { id: f.screen.id, name: 'Booking screen', theatre: { id: f.show.screen.theatre.id, name: 'Booking theatre' } } },
      status: 'PENDING', totalPaise: 10000, expiresAt: '2030-01-01T00:05:00.000Z', createdAt: '2030-01-01T00:00:00.000Z',
      seats: [{ rowName: 'A', seatNumber: 1, seatType: 'REGULAR', pricePaise: 10000 }], payment: { id: 'payment-id', status: 'REFUND_PENDING', amountPaise: 10000 } });
    expect(f.bookingFindMany.mock.calls[0]?.[0]).toMatchObject({ where: { OR: [{ user: { name: { contains: '100\\%\\_', mode: 'insensitive' } } }] }, skip: 3, take: 3 });
    expect(f.bookingFindMany.mock.calls[0]?.[0].where).not.toHaveProperty('userId');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('uses an exact UUID booking filter alongside literal case-insensitive name search', async () => {
    const f = await setup();
    expect((await get(f, `/api/admin/bookings?search=${f.projection().id.toUpperCase()}`)).status).toBe(200);
    expect(f.bookingFindMany.mock.calls[0]?.[0].where.OR).toContainEqual({ id: f.projection().id });
  });
  it('lists payment/reconciliation/refund state without raw provider events or private user fields', async () => {
    const f = await setup(); const response = await get(f, '/api/admin/payments');
    expect(response.status).toBe(200);
    expect(response.body.data.items[0]).toMatchObject({ amountPaise: 10000, createdAt: '2030-01-01T00:00:00.000Z',
      booking: { id: f.projection().id, status: 'CANCELLED', user: { id: f.userId, name: 'Booking user' } },
      refunds: [{ id: 'refund-id', status: 'PENDING', amountPaise: 10000, providerPaymentId: 'pay_primary' }] });
    expect(JSON.stringify(response.body)).not.toMatch(/secret|private|passwordHash|receipt|digest|events|evidence/);
    expect(f.paymentFindMany.mock.calls[0]?.[0].where).not.toHaveProperty('booking');
  });
  it('returns DB-clock UTC primary capture totals, including captures now awaiting/refunded', async () => {
    const f = await setup(); const response = await get(f, '/api/admin/dashboard');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ totalMovies: 3, activeShows: 2, bookingsToday: 4, capturedTodayPaise: 28000 });
    const query = f.queryRaw.mock.calls[0]![0];
    expect(query.sql).toMatch(/CURRENT_TIMESTAMP AT TIME ZONE 'UTC'/);
    expect(query.sql).toMatch(/captured_at >=/); expect(query.sql).toMatch(/captured_at </);
    // Booking.createdAt uses a timestamp without time zone; compare it against
    // UTC timestamp bounds rather than relying on the connection TimeZone.
    expect(query.sql).toMatch(/b\.created_at >= \(bounds\.day_start AT TIME ZONE 'UTC'\)/);
    expect(query.sql).not.toMatch(/p\.status|payment_evidence|refunds/);
  });
  it('rejects unsafe aggregate totals', async () => {
    const f = await setup(); f.state.stats.capturedTodayPaise = 9007199254740992n;
    expect((await get(f, '/api/admin/dashboard')).status).toBe(500);
  });
});
