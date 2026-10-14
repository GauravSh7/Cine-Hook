import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { test } from 'node:test';
import request from 'supertest';
import { createClient } from 'redis';
import { createApp } from '../dist/app.js';
import { createPrisma } from '../dist/lib/prisma.js';
import { AppError } from '../dist/errors/app-error.js';
import { createCatalog } from '../dist/modules/catalog/create-catalog.js';
import { createShows } from '../dist/modules/shows/create-shows.js';
import { createBooking } from '../dist/modules/booking/create-booking.js';
import { PaymentRepository } from '../dist/modules/payments/payment.repository.js';
import { PaymentService } from '../dist/modules/payments/payment.service.js';
import { RazorpayProvider } from '../dist/modules/payments/razorpay.provider.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { TokenService } from '../dist/modules/auth/token.service.js';
import { UserRepository } from '../dist/modules/auth/user.repository.js';
import { HealthService } from '../dist/modules/health/health.service.js';

const databaseUrl = process.env.PAYMENTS_TEST_DATABASE_URL;
const redisUrl = process.env.SEAT_LOCK_TEST_REDIS_URL;
test('Payments HTTP with real PostgreSQL/Redis and actual Razorpay adapter on controlled provider transport',
  { skip: !databaseUrl || !redisUrl, timeout: 90000 }, async t => {
  assert.match(new URL(databaseUrl).pathname, /_test$/); assert.equal(new URL(redisUrl).pathname, '/15');
  const prisma = createPrisma(databaseUrl);
  const inTransaction = new AsyncLocalStorage();
  const transaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (work, options) => typeof work === 'function'
    ? transaction(tx => inTransaction.run(true, () => work(tx)), options) : transaction(work, options);
  const redis = createClient({ url: redisUrl, disableOfflineQueue: true, socket: { reconnectStrategy: false, connectTimeout: 2000 } });
  redis.on('error', () => {});
  const booking = createBooking(prisma, redis), store = new PaymentRepository(prisma);
  const credentials = { keyId: 'rzp_test_integration', keySecret: 'integration-api-secret-only-1234567890', webhookSecret: 'integration-webhook-secret-only-1234567890' };
  const orders = new Map(), providerPayments = new Map();
  const state = { loseOrderAck: false, providerCalls: 0, providerCreates: 0 };
  const transport = async (input, options) => {
    assert.notEqual(inTransaction.getStore(), true, 'Provider HTTP must never run inside this request\'s database transaction.');
    state.providerCalls++;
    const url = new URL(String(input)); assert.equal(url.origin, 'https://api.razorpay.com');
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/v1/orders' && options.method === 'POST') {
      const data = JSON.parse(options.body); assert.equal(data.partial_payment, false);
      if ([...orders.values()].some(value => value.receipt === data.receipt)) {
        return json({ error: { code: 'BAD_REQUEST_ERROR', description: 'receipt already exists' } }, 400);
      }
      state.providerCreates++;
      const value = { id: `order_${randomUUID().replaceAll('-', '')}`, entity: 'order', ...data, status: 'created' };
      orders.set(value.id, value);
      if (state.loseOrderAck) { state.loseOrderAck = false; throw new Error('Injected lost acknowledgement'); }
      return json(value);
    }
    if (url.pathname === '/v1/orders') return json({ entity: 'collection', items: [...orders.values()].filter(value => value.receipt.includes(url.searchParams.get('receipt'))) });
    if (url.pathname.startsWith('/v1/orders/')) return orders.has(url.pathname.split('/').at(-1))
      ? json(orders.get(url.pathname.split('/').at(-1))) : json({ error: {} }, 404);
    if (url.pathname.startsWith('/v1/payments/')) return providerPayments.has(url.pathname.split('/').at(-1))
      ? json(providerPayments.get(url.pathname.split('/').at(-1))) : json({ error: {} }, 404);
    throw new Error('Unexpected provider path');
  };
  const provider = new RazorpayProvider(credentials, transport);
  const paymentService = new PaymentService(store, booking.bookings, provider);
  const userId = randomUUID(), otherUserId = randomUUID(), cityId = randomUUID(), theatreId = randomUUID(), screenId = randomUUID(), movieId = randomUUID();
  const seatIds = [randomUUID(), randomUUID()], showIds = [], bookingIds = [];
  const tokens = new TokenService({ secret: 'payment-integration-jwt-only-123456789012345', expiresInSeconds: 3600 });
  const auth = { service: new AuthService(new UserRepository(prisma), tokens), tokens };
  const appFor = payments => createApp({ frontendOrigin: 'http://localhost:5173', auth, catalog: createCatalog(prisma), shows: createShows(prisma), booking,
    payments: { payments }, healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }) });
  const app = appFor(paymentService), token = tokens.sign({ userId, role: 'USER' }), otherToken = tokens.sign({ userId: otherUserId, role: 'USER' });
  const key = (showId, seatId) => `cinehook:seat-lock:{${showId}}:${seatId}`;
  const orderRequest = (bookingId, target = app, bearer = token) => request(target).post('/api/payments/order').set('Authorization', `Bearer ${bearer}`).send({ bookingId });
  const payment = (order, overrides = {}) => {
    const value = { id: `pay_${randomUUID().replaceAll('-', '')}`, entity: 'payment', order_id: order.id, amount: order.amount,
      currency: order.currency, status: 'captured', captured: true, ...overrides };
    providerPayments.set(value.id, value); return value;
  };
  const verify = (bookingId, value, target = app, overrides = {}, bearer = token) => request(target).post('/api/payments/verify')
    .set('Authorization', `Bearer ${bearer}`).send({ bookingId, razorpay_order_id: value.order_id, razorpay_payment_id: value.id,
      razorpay_signature: createHmac('sha256', credentials.keySecret).update(`${value.order_id}|${value.id}`).digest('hex'), ...overrides });
  const raw = (value, type = 'payment.captured') => Buffer.from(`${JSON.stringify({ entity: 'event', event: type,
    payload: { payment: { entity: value }, ...(type === 'order.paid' ? { order: { entity: { ...orders.get(value.order_id), status: 'paid' } } } : {}) } })}\n`);
  const webhook = (value, eventId = `evt_${randomUUID().replaceAll('-', '')}`, type = 'payment.captured', target = app, signature) => {
    const bytes = raw(value, type);
    return request(target).post('/api/webhooks/razorpay').set('Content-Type', 'application/json')
      .set('X-Razorpay-Event-Id', eventId).set('X-Razorpay-Signature', signature ?? createHmac('sha256', credentials.webhookSecret).update(bytes).digest('hex'))
      .send(bytes.toString('utf8'));
  };
  const newShow = async () => {
    const id = randomUUID(); showIds.push(id); const startsAt = new Date(Date.UTC(2099, 5, showIds.length, 10));
    await prisma.show.create({ data: { id, movieId, screenId, startsAt, endsAt: new Date(startsAt.getTime() + 6000000),
      prices: { create: [{ seatType: 'REGULAR', pricePaise: 10000 }, { seatType: 'PREMIUM', pricePaise: 15000 }] } } });
    return id;
  };
  const fresh = async () => {
    const showId = await newShow();
    const response = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send({ showId, seatIds });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const bookingId = response.body.data.booking.id; bookingIds.push(bookingId);
    const result = await orderRequest(bookingId); assert.equal(result.status, 201, JSON.stringify(result.body));
    return { showId, bookingId, order: orders.get(result.body.data.order.id), response: result };
  };
  const nativePending = async (showId, expiresAt, selected = seatIds) => {
    const id = randomUUID(); bookingIds.push(id);
    await prisma.$transaction(async tx => {
      await tx.booking.create({ data: { id, showId, userId, expiresAt,
        totalPaise: BigInt(selected.reduce((sum, seat) => sum + (seat === seatIds[0] ? 10000 : 15000), 0)) } });
      await tx.bookingSeat.createMany({ data: selected.map(seatId => ({ id: randomUUID(), bookingId: id, showId, seatId, price: seatId === seatIds[0] ? 10000 : 15000 })) });
    }); return id;
  };
  const seededOrder = async (bookingId) => {
    const record = await prisma.booking.findUnique({ where: { id: bookingId } }); const id = randomUUID();
    await prisma.payment.create({ data: { id, bookingId, receipt: id, amountPaise: record.totalPaise } });
    const created = await provider.createOrder({ receipt: id, amountPaise: Number(record.totalPaise), currency: 'INR' });
    await store.attachOrder(id, created); return orders.get(created.id);
  };
  const checkDisposition = async (bookingId, status, reason) => {
    const financial = await prisma.payment.findUnique({ where: { bookingId }, include: { reconciliation: true, evidence: true } });
    assert.equal(financial.status, 'SUCCESS'); assert.ok(financial.capturedAt); assert.ok(financial.bookingFinalizedAt);
    assert.equal((await prisma.booking.findUnique({ where: { id: bookingId } })).status, status);
    if (reason) { assert.equal(financial.reconciliation.reason, reason); assert.equal(financial.reconciliation.compensationRequired, true); }
    else assert.equal(financial.reconciliation, null);
    return financial;
  };
  try {
    await redis.connect();
    for (const id of [userId, otherUserId]) await prisma.user.create({ data: { id, name: 'Payment test', email: `payment-${id}@example.com`, passwordHash: 'integration-only-unusable-hash' } });
    await prisma.city.create({ data: { id: cityId, name: `Payment ${cityId}`, state: 'Test' } });
    await prisma.theatre.create({ data: { id: theatreId, cityId, name: 'Payment theatre', address: 'Test road' } });
    await prisma.screen.create({ data: { id: screenId, theatreId, name: 'Payment screen', capacity: 2 } });
    await prisma.seat.createMany({ data: seatIds.map((id, index) => ({ id, screenId, rowName: 'A', seatNumber: index + 1, seatType: index ? 'PREMIUM' : 'REGULAR' })) });
    await prisma.movie.create({ data: { id: movieId, title: `Payment ${movieId}`, description: 'Test', durationMinutes: 100, releaseDate: new Date('2026-01-01'), language: 'english', genres: ['drama'] } });
    await t.test('server amount, stable receipt/order and provider HTTP outside transactions', async () => {
      const f = await fresh(); assert.equal(f.order.amount, 25000); assert.equal(f.response.body.data.order.keyId, credentials.keyId);
      const creates = state.providerCreates; const repeated = await orderRequest(f.bookingId); assert.equal(repeated.status, 201);
      assert.equal(repeated.body.data.order.id, f.order.id); assert.equal(state.providerCreates, creates);
      assert.equal((await orderRequest(f.bookingId, app, otherToken)).status, 404);
      const forged = await request(app).post('/api/payments/order').set('Authorization', `Bearer ${token}`).send({ bookingId: f.bookingId, amountPaise: 1 });
      assert.equal(forged.status, 400);
    });
    await t.test('authentic authorization does not confirm; forged/mismatched captures have no effects', async () => {
      const f = await fresh(); const authorized = payment(f.order, { status: 'authorized', captured: false });
      assert.equal((await verify(f.bookingId, authorized)).body.data.payment.status, 'PENDING');
      assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId } }), 0);
      const captured = payment(f.order);
      assert.equal((await verify(f.bookingId, captured, app, { razorpay_signature: '0'.repeat(64) })).status, 400);
      assert.equal((await verify(f.bookingId, captured, app, {}, otherToken)).status, 404);
      const bad = payment(f.order, { amount: 1 }); assert.equal((await verify(f.bookingId, bad)).status, 400);
      assert.equal((await webhook(captured, undefined, 'payment.captured', app, '0'.repeat(64))).status, 400);
      assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId } }), 0);
      assert.equal((await prisma.payment.findUnique({ where: { bookingId: f.bookingId } })).status, 'PENDING');
    });
    await t.test('concurrent verify/captured/order-paid replays allocate once and bind provider event identity', async () => {
      const f = await fresh(); const value = payment(f.order), event = `evt_${randomUUID().replaceAll('-', '')}`;
      const responses = await Promise.all([verify(f.bookingId, value), webhook(value, event), webhook(value, event), webhook(value, undefined, 'order.paid')]);
      assert.deepEqual(responses.map(response => response.status), [200, 200, 200, 200]);
      const result = await checkDisposition(f.bookingId, 'CONFIRMED'); assert.equal(result.evidence.filter(item => item.captured).length, 1);
      assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId } }), 2);
      assert.equal((await prisma.paymentWebhookEvent.findUnique({ where: { providerEventId: event } })).processedAt instanceof Date, true);
      assert.equal((await request(app).post(`/api/bookings/${f.bookingId}/confirm`).set('Authorization', `Bearer ${token}`).send({ paid: true })).status, 404);
      assert.equal((await verify(f.bookingId, value)).status, 200);
    });
    await t.test('raw captured webhook recovers a closed browser with no verify call', async () => {
      const f = await fresh(); assert.equal((await webhook(payment(f.order))).status, 200);
      await checkDisposition(f.bookingId, 'CONFIRMED'); assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId } }), 2);
    });
    await t.test('lost order acknowledgement recovers through exact receipt without a second provider order', async () => {
      const showId = await newShow(); const pending = await booking.bookings.create(userId, { showId, seatIds }); bookingIds.push(pending.id);
      state.loseOrderAck = true; const before = state.providerCreates;
      assert.equal((await orderRequest(pending.id)).status, 503);
      const repeated = await orderRequest(pending.id); assert.equal(repeated.status, 201); assert.equal(state.providerCreates, before + 1);
    });
    await t.test('webhook before local order attach binds reserved receipt and fulfills safely', async () => {
      const showId = await newShow(); const pending = await booking.bookings.create(userId, { showId, seatIds }); bookingIds.push(pending.id);
      state.loseOrderAck = true; assert.equal((await orderRequest(pending.id)).status, 503);
      const local = await store.findByBooking(pending.id); assert.equal(local.providerOrderId, null);
      const order = [...orders.values()].find(value => value.receipt === local.receipt);
      assert.equal((await webhook(payment(order))).status, 200); await checkDisposition(pending.id, 'CONFIRMED');
    });
    await t.test('capture after expiry or deliberate release remains SUCCESS with compensation required, no seat revival', async () => {
      const showId = await newShow(), expiredId = await nativePending(showId, new Date(Date.now() - 1000));
      const order = await seededOrder(expiredId); assert.equal((await webhook(payment(order))).status, 200);
      await checkDisposition(expiredId, 'FAILED', 'HOLD_EXPIRED'); assert.equal(await prisma.confirmedSeat.count({ where: { showId } }), 0);
      assert.equal(await redis.exists(seatIds.map(id => key(showId, id))), 0);
      const f = await fresh(); assert.equal((await request(app).delete(`/api/bookings/${f.bookingId}/hold`).set('Authorization', `Bearer ${token}`)).status, 200);
      assert.equal((await verify(f.bookingId, payment(f.order))).status, 200); await checkDisposition(f.bookingId, 'FAILED', 'HOLD_RELEASED');
      assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId } }), 0);
    });
    await t.test('verified capture corrects earlier financial failure; stale failure cannot downgrade SUCCESS', async () => {
      const f = await fresh(); const value = payment(f.order, { status: 'failed', captured: false });
      assert.equal((await webhook(value, undefined, 'payment.failed')).status, 200);
      assert.equal((await store.findByBooking(f.bookingId)).status, 'FAILED');
      await request(app).delete(`/api/bookings/${f.bookingId}/hold`).set('Authorization', `Bearer ${token}`);
      const captured = { ...value, status: 'captured', captured: true }; providerPayments.set(value.id, captured);
      assert.equal((await webhook(captured)).status, 200); await checkDisposition(f.bookingId, 'FAILED', 'HOLD_RELEASED');
      assert.equal((await webhook(value, undefined, 'payment.failed')).status, 200); assert.equal((await store.findByBooking(f.bookingId)).status, 'SUCCESS');
    });
    await t.test('SQL allocation collision rolls back the ticket but retains SUCCESS and compensation condition', async () => {
      const f = await fresh(), winner = await nativePending(f.showId, new Date(Date.now() + 300000), [seatIds[0]]);
      await prisma.$executeRaw`UPDATE bookings SET status='CONFIRMED' WHERE id=${winner}::uuid`;
      assert.equal((await verify(f.bookingId, payment(f.order))).status, 200);
      await checkDisposition(f.bookingId, 'FAILED', 'FULFILLMENT_CONFLICT');
      assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId } }), 1);
      assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId, seatId: seatIds[1] } }), 0);
    });
    for (const [status, code] of [[503, 'DATABASE_UNAVAILABLE'], [409, 'CONCURRENT_CHANGE']]) {
    await t.test(`${code} rollback preserves financial evidence and Redis holds for retry`, async () => {
      const f = await fresh(); const value = payment(f.order); let rejectOnce = true;
      const failingStore = { reserve: store.reserve.bind(store), attachOrder: store.attachOrder.bind(store), findByBooking: store.findByBooking.bind(store),
        findByOrder: store.findByOrder.bind(store), findByReceipt: store.findByReceipt.bind(store), recordEvidence: store.recordEvidence.bind(store),
        markEventProcessed: store.markEventProcessed.bind(store), finalize: (id, work) => store.finalize(id, async scope => {
          const result = await work(scope); if (rejectOnce) { rejectOnce = false; throw new AppError(status, code, 'Injected transaction rollback'); } return result;
        }) };
      const target = appFor(new PaymentService(failingStore, booking.bookings, provider));
      assert.equal((await verify(f.bookingId, value, target)).status, status);
      const financial = await store.findByBooking(f.bookingId); assert.equal(financial.status, 'SUCCESS'); assert.equal(financial.bookingFinalizedAt, null);
      assert.equal(financial.reconciliation.reason, 'FULFILLMENT_PENDING'); assert.equal(financial.reconciliation.compensationRequired, false);
      assert.equal((await prisma.booking.findUnique({ where: { id: f.bookingId } })).status, 'PENDING');
      assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId } }), 0); assert.equal(await redis.exists(seatIds.map(id => key(f.showId, id))), 2);
      assert.equal((await verify(f.bookingId, value, target)).status, 200); await checkDisposition(f.bookingId, 'CONFIRMED');
    });
    }
    await t.test('Redis outage does not erase capture; same webhook retries unfinished fulfillment after recovery', async () => {
      const f = await fresh(); const value = payment(f.order), event = `evt_${randomUUID().replaceAll('-', '')}`; redis.destroy();
      assert.equal((await webhook(value, event)).status, 503);
      const financial = await store.findByBooking(f.bookingId); assert.equal(financial.status, 'SUCCESS'); assert.equal(financial.bookingFinalizedAt, null);
      assert.equal((await prisma.paymentWebhookEvent.findUnique({ where: { providerEventId: event } })).processedAt, null);
      await redis.connect(); assert.equal((await webhook(value, event)).status, 200); await checkDisposition(f.bookingId, 'CONFIRMED');
    });
    await t.test('fetched external refunded state cannot fulfill an interrupted capture', async () => {
      const f = await fresh(); const value = payment(f.order); redis.destroy();
      assert.equal((await verify(f.bookingId, value)).status, 503);
      await redis.connect(); providerPayments.set(value.id, { ...value, status: 'refunded', captured: true });
      const retried = await verify(f.bookingId, value); assert.equal(retried.status, 409);
      assert.equal(retried.body.error.code, 'PAYMENT_RECONCILIATION_REQUIRED');
      const financial = await store.findByBooking(f.bookingId); assert.equal(financial.status, 'SUCCESS'); assert.equal(financial.bookingFinalizedAt, null);
      assert.equal(financial.reconciliation.reason, 'FULFILLMENT_PENDING');
      assert.equal((await prisma.booking.findUnique({ where: { id: f.bookingId } })).status, 'PENDING');
      assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId } }), 0);
      assert.equal(await redis.exists(seatIds.map(id => key(f.showId, id))), 2);
    });
  } finally {
    // Delete only this run's fixture financial records before protected Booking cleanup.
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.$executeRaw`UPDATE bookings SET status='CANCELLED',updated_at=clock_timestamp() WHERE show_id IN (SELECT id FROM shows WHERE movie_id=${movieId}::uuid) AND status='CONFIRMED'`;
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    if (!redis.isOpen) await redis.connect();
    if (showIds.length) await redis.del(showIds.flatMap(showId => seatIds.map(seatId => key(showId, seatId))));
    await prisma.show.deleteMany({ where: { id: { in: showIds } } }); await prisma.seat.deleteMany({ where: { id: { in: seatIds } } });
    await prisma.screen.deleteMany({ where: { id: screenId } }); await prisma.theatre.deleteMany({ where: { id: theatreId } });
    await prisma.city.deleteMany({ where: { id: cityId } }); await prisma.movie.deleteMany({ where: { id: movieId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    if (redis.isOpen) redis.destroy(); await prisma.$disconnect();
  }
});
