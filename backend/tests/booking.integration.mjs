import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import request from 'supertest';
import { createClient } from 'redis';
import { createApp } from '../dist/app.js';
import { createPrisma } from '../dist/lib/prisma.js';
import { createCatalog } from '../dist/modules/catalog/create-catalog.js';
import { createShows } from '../dist/modules/shows/create-shows.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { TokenService } from '../dist/modules/auth/token.service.js';
import { UserRepository } from '../dist/modules/auth/user.repository.js';
import { HealthService } from '../dist/modules/health/health.service.js';
import { SeatLockService } from '../dist/modules/seat-lock/seat-lock.service.js';

const databaseUrl = process.env.BOOKING_TEST_DATABASE_URL;
const redisUrl = process.env.SEAT_LOCK_TEST_REDIS_URL;
test('Booking API with actual PostgreSQL and Redis: holds, price snapshots, ownership and confirmation', { skip: !databaseUrl || !redisUrl, timeout: 45000 }, async t => {
  assert.match(new URL(databaseUrl).pathname, /_test$/);
  assert.equal(new URL(redisUrl).pathname, '/15');
  const { BookingRepository } = await import('../dist/modules/booking/booking.repository.js');
  const { BookingService } = await import('../dist/modules/booking/booking.service.js');
  const prisma = createPrisma(databaseUrl);
  const redis = createClient({ url: redisUrl, disableOfflineQueue: true, socket: { reconnectStrategy: false, connectTimeout: 2000 } });
  redis.on('error', () => {});
  const locks = new SeatLockService(redis), store = new BookingRepository(prisma), service = new BookingService(store, locks);
  const userId = randomUUID(), otherUserId = randomUUID(), cityId = randomUUID(), theatreId = randomUUID(), screenId = randomUUID(), movieId = randomUUID();
  const seatIds = [randomUUID(), randomUUID()], showIds = [], bookingIds = [];
  const run = randomUUID();
  const tokens = new TokenService({ secret: 'booking-integration-only-key-1234567890123456789', expiresInSeconds: 3600 });
  const auth = { service: new AuthService(new UserRepository(prisma), tokens), tokens };
  const app = createApp({ frontendOrigin: 'http://localhost:5173', catalog: createCatalog(prisma), shows: createShows(prisma), booking: { bookings: service }, auth,
    healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }) });
  const token = tokens.sign({ userId, role: 'USER' }), otherToken = tokens.sign({ userId: otherUserId, role: 'USER' });
  const key = (showId, seatId) => `cinehook:seat-lock:{${showId}}:${seatId}`;
  const post = (showId, ids = seatIds, bearer = token) => request(app).post('/api/bookings').set('Authorization', `Bearer ${bearer}`).send({ showId, seatIds: ids });
  const get = (id, bearer = token) => request(app).get(`/api/bookings/${id}`).set('Authorization', `Bearer ${bearer}`);
  const release = (id, bearer = token) => request(app).delete(`/api/bookings/${id}/hold`).set('Authorization', `Bearer ${bearer}`);
  const newShow = async () => {
    const id = randomUUID(); showIds.push(id);
    const startsAt = new Date(Date.UTC(2099, 0, showIds.length, 10));
    await prisma.show.create({ data: { id, movieId, screenId, startsAt, endsAt: new Date(startsAt.getTime() + 6000000),
      prices: { create: [{ seatType: 'REGULAR', pricePaise: 10000 }, { seatType: 'PREMIUM', pricePaise: 15000 }] } } });
    const persistedStart = await prisma.$queryRaw`SELECT floor(extract(epoch FROM starts_at)*1000)::bigint AS "epochMs" FROM shows WHERE id=${id}::uuid`;
    assert.equal(Number(persistedStart[0].epochMs), startsAt.getTime(), 'Show storage must preserve the requested UTC instant.');
    return id;
  };
  const created = async (showId, ids = seatIds) => {
    const response = await post(showId, ids); assert.equal(response.status, 201, JSON.stringify(response.body));
    bookingIds.push(response.body.data.booking.id); return response.body.data.booking;
  };
  const nativePending = async (showId, ids = seatIds, expiresAt = new Date(Date.now() + 300000)) => {
    const id = randomUUID(); bookingIds.push(id);
    await prisma.$transaction(async tx => {
      await tx.booking.create({ data: { id, userId, showId, expiresAt, totalPaise: BigInt(ids.reduce((sum, seatId) => sum + (seatId === seatIds[0] ? 10000 : 15000), 0)) } });
      await tx.bookingSeat.createMany({ data: ids.map(seatId => ({ id: randomUUID(), bookingId: id, showId, seatId, price: seatId === seatIds[0] ? 10000 : 15000 })) });
    });
    return id;
  };
  try {
    await redis.connect();
    for (const id of [userId, otherUserId]) await prisma.user.create({ data: { id, name: 'Booking integration', email: `booking-${id}@example.com`, role: 'USER', passwordHash: 'integration-only-unusable-hash' } });
    await prisma.city.create({ data: { id: cityId, name: `Booking ${run}`, state: 'Test state' } });
    await prisma.theatre.create({ data: { id: theatreId, name: 'Booking theatre', address: 'Test road', cityId } });
    await prisma.screen.create({ data: { id: screenId, name: 'Booking screen', capacity: 2, theatreId } });
    await prisma.seat.createMany({ data: seatIds.map((id, index) => ({ id, screenId, rowName: 'A', seatNumber: index + 1, seatType: index === 0 ? 'REGULAR' : 'PREMIUM' })) });
    await prisma.movie.create({ data: { id: movieId, title: `Booking ${run}`, description: 'Test', durationMinutes: 100, releaseDate: new Date('2026-01-01'), language: 'english', genres: ['drama'] } });
    await t.test('HTTP uses server pricing, owner-scoped reads and availability without leaking lock owners', async () => {
      const showId = await newShow();
      const rejected = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send({ showId, seatIds, totalPaise: 1 });
      assert.equal(rejected.status, 400);
      assert.equal((await request(app).post('/api/bookings').send({ showId, seatIds })).status, 401);
      const booking = await created(showId); assert.equal(booking.totalPaise, 25000); assert.equal(booking.status, 'PENDING');
      assert.equal(Date.parse(booking.expiresAt), await redis.sendCommand(['PEXPIRETIME', key(showId, seatIds[0])]), 'Booking expiry must preserve the actual Redis server expiry.');
      const persistedExpiry = await prisma.$queryRaw`SELECT floor(extract(epoch FROM expires_at)*1000)::bigint AS "epochMs" FROM bookings WHERE id=${booking.id}::uuid`;
      assert.equal(Number(persistedExpiry[0].epochMs), Date.parse(booking.expiresAt), 'Persisted SQL expiry must preserve the Redis instant.');
      assert.deepEqual(booking.seats.map(seat => seat.pricePaise).sort((a, b) => a - b), [10000, 15000]);
      assert.equal((await get(booking.id, otherToken)).status, 404); assert.equal((await release(booking.id, otherToken)).status, 404);
      const availability = await request(app).get(`/api/shows/${showId}/availability`); assert.equal(availability.status, 200);
      assert.ok(availability.body.data.seats.every(seat => seat.availability === 'LOCKED' && seat.remainingHoldMs > 0 && seat.remainingHoldMs <= 300000));
      assert.ok(availability.body.data.seats.every(seat => !('owner' in seat) && !('holdId' in seat) && !('userId' in seat)));
      const staticSeats = await request(app).get(`/api/shows/${showId}/seats`); assert.ok(staticSeats.body.data.seats.every(seat => !('availability' in seat)));
      assert.equal((await post(showId)).status, 409);
      await service.confirm(booking.id);
      const confirmed = (await get(booking.id)).body.data.booking;
      assert.equal(confirmed.status, 'CONFIRMED');
      assert.ok(Math.abs(Date.parse(confirmed.confirmedAt) - Date.now()) < 5000, 'Confirmed timestamp must preserve the database instant.');
      assert.equal(await prisma.confirmedSeat.count({ where: { showId } }), 2);
      assert.equal((await release(booking.id)).status, 409);
      assert.ok((await request(app).get(`/api/shows/${showId}/availability`)).body.data.seats.every(seat => seat.availability === 'BOOKED'));
      assert.equal((await request(app).post(`/api/bookings/${booking.id}/confirm`).set('Authorization', `Bearer ${token}`).send({})).status, 404);
      await service.confirm(booking.id); assert.equal(await prisma.confirmedSeat.count({ where: { showId } }), 2);
    });
    await t.test('server quote changes before creation and remains immutable after creation', async () => {
      const showId = await newShow();
      await prisma.showSeatPrice.update({ where: { showId_seatType: { showId, seatType: 'REGULAR' } }, data: { pricePaise: 12000 } });
      const booking = await created(showId); assert.equal(booking.totalPaise, 27000);
      await prisma.showSeatPrice.update({ where: { showId_seatType: { showId, seatType: 'REGULAR' } }, data: { pricePaise: 99000 } });
      await service.confirm(booking.id); assert.equal((await get(booking.id)).body.data.booking.totalPaise, 27000);
      assert.equal(Number((await prisma.booking.findUnique({ where: { id: booking.id } })).totalPaise), 27000);
    });
    await t.test('release ends a pending hold without deleting the booking and allows another hold', async () => {
      const showId = await newShow(); const old = await created(showId);
      const response = await release(old.id); assert.equal(response.status, 200);
      assert.equal(response.body.data.booking.status, 'CANCELLED'); assert.equal(response.body.data.booking.failureCode, 'CHECKOUT_CANCELLED');
      assert.equal(await redis.exists(seatIds.map(id => key(showId, id))), 0);
      await assert.rejects(service.confirm(old.id), { status: 409, code: 'CHECKOUT_CANCELLED' });
      assert.equal(await prisma.confirmedSeat.count({ where: { showId } }), 0);
      await created(showId);
    });
    await t.test('lost hold fails confirmation without reacquisition and preserves a new same-user hold', async () => {
      const showId = await newShow(); const old = await created(showId);
      for (const id of seatIds) await redis.pExpire(key(showId, id), 0);
      const replacement = await created(showId);
      await assert.rejects(service.confirm(old.id), { status: 409, code: 'HOLD_LOST' });
      assert.equal((await get(old.id)).body.data.booking.status, 'FAILED');
      assert.equal(await locks.validate(showId, seatIds, userId, replacement.id), true);
      assert.equal(await prisma.confirmedSeat.count({ where: { showId } }), 0);
    });
    await t.test('expired persisted hold fails through the trusted internal confirmation path', async () => {
      const showId = await newShow(); const id = await nativePending(showId, seatIds, new Date(Date.now() - 1000));
      await assert.rejects(service.confirm(id), { status: 409, code: 'HOLD_EXPIRED' });
      assert.equal((await get(id)).body.data.booking.status, 'FAILED');
      assert.equal(await prisma.confirmedSeat.count({ where: { showId } }), 0);
    });
    await t.test('SQL duplicate allocation rolls back every seat in a multi-seat confirmation', async () => {
      const showId = await newShow(); const first = await created(showId, [seatIds[0]]); const overlappingId = await nativePending(showId);
      await service.confirm(first.id);
      let collision;
      try { await prisma.booking.update({ where: { id: overlappingId }, data: { status: 'CONFIRMED' } }); }
      catch (error) { collision = error; }
      assert.ok(collision, 'The actual unique allocation constraint must reject the conflicting confirmation.');
      assert.equal(collision.meta.driverAdapterError.cause.originalCode, '23505');
      assert.equal((await prisma.booking.findUnique({ where: { id: overlappingId } })).status, 'PENDING');
      assert.equal(await prisma.confirmedSeat.count({ where: { showId } }), 1);
      assert.equal(await prisma.confirmedSeat.count({ where: { showId, seatId: seatIds[1] } }), 0);
      assert.equal((await post(showId)).status, 409);
      // Existing durable allocation wins even if a fresh Redis hold exists.
      // Exercise the production repository's actual Prisma collision mapping.
      await locks.acquire(showId, seatIds, userId, overlappingId);
      await assert.rejects(service.confirm(overlappingId), { status: 409, code: 'SEAT_BOOKED' });
      assert.equal((await prisma.booking.findUnique({ where: { id: overlappingId } })).status, 'FAILED');
      assert.equal(await prisma.confirmedSeat.count({ where: { showId } }), 1);
      assert.equal(await redis.exists(seatIds.map(id => key(showId, id))), 0);
    });
    await t.test('failed database save compensates its own actual Redis hold', async () => {
      const showId = await newShow(); const failingId = randomUUID();
      const failingStore = {
        context: store.context.bind(store), createPending: async () => { throw new Error('Injected database save failure'); },
        transition: store.transition.bind(store), findById: store.findById.bind(store), listByUser: store.listByUser.bind(store),
        failPending: store.failPending.bind(store), expirePendingForUser: store.expirePendingForUser.bind(store),
      };
      const failing = new BookingService(failingStore, locks, () => failingId);
      await assert.rejects(failing.create(userId, { showId, seatIds }));
      assert.equal(await redis.exists(seatIds.map(id => key(showId, id))), 0);
      await created(showId);
    });
    await t.test('concurrent confirmation and release serialize to one permanent outcome without partial allocation', async () => {
      for (let iteration = 0; iteration < 8; iteration++) {
        const showId = await newShow(); const booking = await created(showId);
        const race = await Promise.allSettled([service.confirm(booking.id), service.releaseHold(userId, booking.id)]);
        assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(race.find(result => result.status === 'rejected').reason.status, 409);
        const final = await prisma.booking.findUnique({ where: { id: booking.id } });
        assert.ok(final.status === 'CONFIRMED' || final.status === 'CANCELLED');
        assert.equal(await prisma.confirmedSeat.count({ where: { showId } }), final.status === 'CONFIRMED' ? 2 : 0);
        assert.equal(await redis.exists(seatIds.map(id => key(showId, id))), 0);
      }
    });
    await t.test('Redis outage yields safe503 in the combined HTTP API', async () => {
      const showId = await newShow(); redis.destroy();
      for (const response of [await post(showId), await request(app).get(`/api/shows/${showId}/availability`)]) {
        assert.equal(response.status, 503); assert.equal(response.body.error.code, 'SEAT_LOCK_UNAVAILABLE');
        assert.deepEqual(Object.keys(response.body.error).sort(), ['code', 'message', 'requestId']);
        assert.equal(response.body.error.requestId, response.headers['x-request-id']);
      }
      assert.equal(await prisma.booking.count({ where: { showId } }), 0);
    });
  } finally {
    // Trigger guards require cancellation before deletion of confirmed bookings.
    await prisma.$executeRaw`UPDATE bookings SET status='CANCELLED',updated_at=clock_timestamp() WHERE show_id IN (SELECT id FROM shows WHERE movie_id=${movieId}::uuid) AND status='CONFIRMED'`;
    await prisma.booking.deleteMany({ where: { showId: { in: showIds } } });
    if (!redis.isOpen) await redis.connect();
    if (showIds.length) await redis.del(showIds.flatMap(showId => seatIds.map(id => key(showId, id))));
    await prisma.show.deleteMany({ where: { id: { in: showIds } } });
    await prisma.seat.deleteMany({ where: { id: { in: seatIds } } });
    await prisma.screen.deleteMany({ where: { id: screenId } });
    await prisma.theatre.deleteMany({ where: { id: theatreId } });
    await prisma.city.deleteMany({ where: { id: cityId } });
    await prisma.movie.deleteMany({ where: { id: movieId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    if (redis.isOpen) redis.destroy(); await prisma.$disconnect();
  }
});
