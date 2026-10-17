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
import { BookingRepository } from '../dist/modules/booking/booking.repository.js';
import { BookingService } from '../dist/modules/booking/booking.service.js';
import { SeatLockService } from '../dist/modules/seat-lock/seat-lock.service.js';
import { PaymentRepository } from '../dist/modules/payments/payment.repository.js';
import { PaymentService } from '../dist/modules/payments/payment.service.js';
import { RefundRepository } from '../dist/modules/refunds/refund.repository.js';
import { RefundService } from '../dist/modules/refunds/refund.service.js';
import { RazorpayProvider } from '../dist/modules/payments/razorpay.provider.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { TokenService } from '../dist/modules/auth/token.service.js';
import { UserRepository } from '../dist/modules/auth/user.repository.js';
import { HealthService } from '../dist/modules/health/health.service.js';
import {legacyTicketPolicy} from './helpers/legacy-tax-fixture.mjs';

const databaseUrl = process.env.REFUNDS_TEST_DATABASE_URL;
const redisUrl = process.env.SEAT_LOCK_TEST_REDIS_URL;
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
const providerId = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test('Refund HTTP with real PostgreSQL/Redis and actual Razorpay adapter on controlled transport',
  { skip: !databaseUrl || !redisUrl, timeout: 120000 }, async t => {
  const database = new URL(databaseUrl), cache = new URL(redisUrl);
  assert.ok(loopback.has(database.hostname), 'Refund tests and protected fixture cleanup require loopback PostgreSQL.');
  assert.match(database.pathname, /^\/[A-Za-z0-9_]+_test$/);
  assert.ok(loopback.has(cache.hostname), 'Refund tests require loopback Redis.');
  assert.equal(cache.pathname, '/15');
  const prisma = createPrisma(databaseUrl), inTransaction = new AsyncLocalStorage();
  const transaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (work, options) => typeof work === 'function'
    ? transaction(tx => inTransaction.run(true, () => work(tx)), options) : transaction(work, options);
  const redis = createClient({ url: redisUrl, disableOfflineQueue: true, socket: { reconnectStrategy: false, connectTimeout: 2000 } });
  redis.on('error', () => {});
  const booking = createBooking(prisma, redis), paymentsStore = new PaymentRepository(prisma), refundsStore = new RefundRepository(prisma);
  const credentials = { keyId: 'rzp_test_refunds_integration', keySecret: 'refunds-integration-api-secret-only-1234567890',
    webhookSecret: 'refunds-integration-webhook-secret-only-1234567890' };
  const orders = new Map(), providerPayments = new Map(), providerRefunds = new Map(), refundKeys = new Map();
  const createStatus = new Map(), outages = new Set(), lostAcknowledgements = new Set(), fetchOutages = new Set(), beforeAttach = new Map();
  const requests = [], contractErrors = [], cancelledSources = new Map(), eventIds = [];
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const transport = async (input, options) => {
    try {
      assert.notEqual(inTransaction.getStore(), true, 'Provider HTTP must run after the request database transaction commits.');
      const url = new URL(String(input)); assert.equal(url.origin, 'https://api.razorpay.com');
      if (url.pathname === '/v1/orders' && options.method === 'POST') {
        const body = JSON.parse(options.body); assert.equal(body.partial_payment, false);
        const prior = [...orders.values()].find(value => value.receipt === body.receipt);
        if (prior) return json({ error: { code: 'BAD_REQUEST_ERROR', description: 'receipt already exists' } }, 400);
        const value = { ...body, id: providerId('order'), entity: 'order', status: 'created' }; orders.set(value.id, value); return json(value);
      }
      if (url.pathname === '/v1/orders') return json({ entity: 'collection', items: [...orders.values()].filter(value => value.receipt === url.searchParams.get('receipt')) });
      if (url.pathname.startsWith('/v1/orders/')) return json(orders.get(url.pathname.split('/').at(-1)) ?? {}, orders.has(url.pathname.split('/').at(-1)) ? 200 : 404);
      const refundPath = /^\/v1\/payments\/(pay_[A-Za-z0-9]+)\/refund$/.exec(url.pathname);
      if (refundPath && options.method === 'POST') {
        const paymentId = refundPath[1], key = new Headers(options.headers).get('X-Refund-Idempotency');
        const body = JSON.parse(options.body); assert.match(key, uuid); assert.match(body.receipt, uuid);
        assert.deepEqual(Object.keys(body).sort(), ['amount', 'receipt', 'speed']);
        assert.equal(body.amount, providerPayments.get(paymentId).amount); assert.equal(body.speed, 'normal'); assert.equal(body.receipt, key);
        requests.push({ paymentId, key, body: options.body, method: 'POST' });
        if (cancelledSources.has(paymentId)) {
          const id = cancelledSources.get(paymentId);
          const committed = await prisma.booking.findUnique({ where: { id } });
          assert.equal(committed.status, 'CANCELLED', 'Cancellation must be visible to another database read before provider HTTP.');
          assert.equal(await prisma.confirmedSeat.count({ where: { bookingSeat: { bookingId: id } } }), 0);
          const durable = await prisma.refund.findUnique({ where: { providerPaymentId: paymentId }, include: { attempts: true } });
          assert.equal(durable.amountPaise, BigInt(providerPayments.get(paymentId).amount)); assert.equal(durable.currency, 'INR');
          assert.ok(durable.attempts.some(attempt => attempt.id === key));
        }
        if (outages.has(paymentId)) throw new Error('Injected refund provider outage');
        let value;
        if (refundKeys.has(key)) {
          const original = requests.find(call => call.key === key); assert.equal(original.body, options.body); assert.equal(original.paymentId, paymentId);
          value = providerRefunds.get(refundKeys.get(key));
        } else {
          value = { id: providerId('rfnd'), entity: 'refund', payment_id: paymentId, amount: body.amount,
            currency: 'INR', receipt: body.receipt, status: createStatus.get(paymentId) ?? 'processed' };
          refundKeys.set(key, value.id); providerRefunds.set(value.id, value);
        }
        const hook = beforeAttach.get(paymentId);
        if (hook) { beforeAttach.delete(paymentId); await hook(value); }
        if (lostAcknowledgements.delete(paymentId)) throw new Error('Injected accepted refund with lost acknowledgement');
        return json(value);
      }
      if (url.pathname.startsWith('/v1/refunds/')) {
        const id = url.pathname.split('/').at(-1); requests.push({ method: 'GET', id });
        if (fetchOutages.has(id)) throw new Error('Injected authoritative refund fetch outage');
        return json(providerRefunds.get(id) ?? {}, providerRefunds.has(id) ? 200 : 404);
      }
      if (url.pathname.startsWith('/v1/payments/')) return json(providerPayments.get(url.pathname.split('/').at(-1)) ?? {}, providerPayments.has(url.pathname.split('/').at(-1)) ? 200 : 404);
      throw new Error(`Unexpected controlled provider path: ${url.pathname}`);
    } catch (error) {
      // Production correctly catches transport failures; retain assertion failures
      // separately so pending-state tests cannot accidentally hide a bad request.
      if (error?.code === 'ERR_ASSERTION') contractErrors.push(error.message);
      throw error;
    }
  };
  const provider = new RazorpayProvider(credentials, transport), refunds = new RefundService(refundsStore, booking.bookings, provider);
  const payments = new PaymentService(paymentsStore, booking.bookings, provider, refunds);
  const userId = randomUUID(), otherUserId = randomUUID(), adminId = randomUUID(), cityId = randomUUID(), theatreId = randomUUID(), screenId = randomUUID(), movieId = randomUUID();
  const seatIds = [randomUUID(), randomUUID()], bookingIds = [], showIds = [];
  const tokens = new TokenService({ secret: 'refunds-integration-jwt-only-123456789012345', expiresInSeconds: 3600 });
  const auth = { service: new AuthService(new UserRepository(prisma), tokens), tokens };
  const appFor = (selectedRefunds = refunds, selectedBooking = booking) => createApp({ frontendOrigin: 'http://localhost:5173', auth,
    catalog: createCatalog(prisma), shows: createShows(prisma), booking: selectedBooking,
    payments: { payments: new PaymentService(paymentsStore, selectedBooking.bookings, provider, selectedRefunds), refunds: selectedRefunds },
    healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }) });
  const app = createApp({ frontendOrigin: 'http://localhost:5173', auth, catalog: createCatalog(prisma), shows: createShows(prisma), booking,
    payments: { payments, refunds }, healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }) });
  const token = tokens.sign({ userId, role: 'USER' }), otherToken = tokens.sign({ userId: otherUserId, role: 'USER' });
  const adminToken = tokens.sign({ userId: adminId, role: 'ADMIN' });
  const key = (showId, seatId) => `cinehook:seat-lock:{${showId}}:${seatId}`;
  const ownerPost = (path, body = {}, bearer = token, target = app) => request(target).post(path).set('Authorization', `Bearer ${bearer}`).send(body);
  const cancel = (id, target = app) => ownerPost(`/api/bookings/${id}/cancel`, {}, token, target);
  const retry = id => ownerPost(`/api/bookings/${id}/refund/retry`);
  const view = id => request(app).get(`/api/bookings/${id}/refunds`).set('Authorization', `Bearer ${token}`);
  const capture = (order, overrides = {}) => {
    const value = { id: providerId('pay'), entity: 'payment', order_id: order.id, amount: order.amount, currency: order.currency,
      status: 'captured', captured: true, ...overrides }; providerPayments.set(value.id, value); return value;
  };
  const verify = (id, payment) => ownerPost('/api/payments/verify', { bookingId: id, razorpay_order_id: payment.order_id,
    razorpay_payment_id: payment.id, razorpay_signature: createHmac('sha256', credentials.keySecret).update(`${payment.order_id}|${payment.id}`).digest('hex') });
  const webhook = (value, type = 'payment.captured', eventId = providerId('evt'), signature, target = app) => {
    eventIds.push(eventId);
    const bytes = Buffer.from(`${JSON.stringify({ entity: 'event', event: type,
      payload: type.startsWith('refund.') ? { refund: { entity: value } } : { payment: { entity: value },
        ...(type === 'order.paid' ? { order: { entity: { ...orders.get(value.order_id), status: 'paid' } } } : {}) } })}\n`);
    return request(target).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('X-Razorpay-Event-Id', eventId)
      .set('X-Razorpay-Signature', signature ?? createHmac('sha256', credentials.webhookSecret).update(bytes).digest('hex')).send(bytes.toString('utf8'));
  };
  const newShow = async (startsAt = new Date(Date.UTC(2099, 0, showIds.length + 1, 10))) => {
    const id = randomUUID(); showIds.push(id);
    await prisma.show.create({ data: { id, movieId, screenId, startsAt, endsAt: new Date(startsAt.getTime() + 6000000),
      prices: { create: [{ seatType: 'REGULAR', pricePaise: 10000 }, { seatType: 'PREMIUM', pricePaise: 15000 }] } } }); return id;
  };
  const create = async (showId, bearer = token) => {
    const response = await ownerPost('/api/bookings', { showId, seatIds }, bearer);
    if (response.status === 201) bookingIds.push(response.body.data.booking.id);
    return response;
  };
  const fresh = async (confirmed = true) => {
    const showId = await newShow(), response = await create(showId);
    assert.equal(response.status, 201, JSON.stringify(response.body)); const bookingId = response.body.data.booking.id;
    const ordered = await ownerPost('/api/payments/order', { bookingId }); assert.equal(ordered.status, 201, JSON.stringify(ordered.body));
    const order = orders.get(ordered.body.data.order.id), value = capture(order);
    if (confirmed) { const result = await verify(bookingId, value); assert.equal(result.status, 200, JSON.stringify(result.body)); }
    return { bookingId, showId, order, value };
  };
  const financial = id => prisma.payment.findUnique({ where: { bookingId: id }, include: { evidence: true, reconciliation: true,
    refunds: { include: { attempts: { orderBy: { sequence: 'asc' } } }, orderBy: { createdAt: 'asc' } } } });
  const refundFor = source => prisma.refund.findUnique({ where: { providerPaymentId: source }, include: { attempts: { orderBy: { sequence: 'asc' } } } });
  const providerRefundFor = source => [...providerRefunds.values()].find(value => value.payment_id === source);
  const cancelled = async (f, pending = false) => {
    const result = await financial(f.bookingId);
    assert.equal((await prisma.booking.findUnique({ where: { id: f.bookingId } })).status, 'CANCELLED');
    assert.equal(result.status, pending ? 'REFUND_PENDING' : 'REFUNDED');
    assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId } }), 0);
    assert.equal(result.providerPaymentId, f.value.id); assert.ok(result.capturedAt); assert.ok(result.bookingFinalizedAt);
    assert.equal(result.evidence.find(value => value.providerPaymentId === f.value.id).captured, true);
    return result;
  };
  const markCancelling = f => cancelledSources.set(f.value.id, f.bookingId);
  try {
    await redis.connect();
    for (const [id, role] of [[userId, 'USER'], [otherUserId, 'USER'], [adminId, 'ADMIN']]) await prisma.user.create({ data: {
      id, role, name: 'Refund integration', email: `refund-${id}@example.com`, passwordHash: 'integration-only-unusable-hash' } });
    await prisma.city.create({ data: { id: cityId, name: `Refund ${cityId}`, state: 'Test' } });
    await prisma.theatre.create({ data: { id: theatreId, cityId, name: 'Refund theatre', address: 'Test road' } });
    await legacyTicketPolicy(prisma,theatreId);
    await prisma.screen.create({ data: { id: screenId, theatreId, name: 'Refund screen', capacity: 2 } });
    await prisma.seat.createMany({ data: seatIds.map((id, index) => ({ id, screenId, rowName: 'A', seatNumber: index + 1, seatType: index ? 'PREMIUM' : 'REGULAR' })) });
    await prisma.movie.create({ data: { id: movieId, title: `Refund ${movieId}`, description: 'Test', durationMinutes: 100,
      releaseDate: new Date('2026-01-01'), language: 'english', genres: ['drama'] } });

    await t.test('owner cancellation commits full source refund and permanent seat release before provider HTTP, retaining quote history', async () => {
      const f = await fresh(), before = await financial(f.bookingId);
      const quotes = await prisma.bookingSeat.findMany({ where: { bookingId: f.bookingId }, orderBy: { seatId: 'asc' } }); markCancelling(f);
      const response = await cancel(f.bookingId); assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.data.booking.status, 'CANCELLED'); assert.equal(response.body.data.payment.status, 'REFUNDED');
      assert.equal(response.body.data.refunds[0].amountPaise, 25700); assert.equal(response.headers['cache-control'], 'no-store');
      const after = await cancelled(f); assert.equal(after.refunds.length, 1); assert.equal(after.refunds[0].status, 'REFUNDED');
      assert.deepEqual(after.capturedAt, before.capturedAt); assert.deepEqual(after.bookingFinalizedAt, before.bookingFinalizedAt);
      assert.deepEqual(await prisma.bookingSeat.findMany({ where: { bookingId: f.bookingId }, orderBy: { seatId: 'asc' } }), quotes);
      assert.equal((await view(f.bookingId)).body.data.refunds[0].amountPaise, 25700);
      assert.deepEqual(contractErrors, []);
    });
    await t.test('provider outage leaves durable cancelled booking, pending full refund and reusable seats', async () => {
      const f = await fresh(); outages.add(f.value.id); markCancelling(f);
      assert.equal((await cancel(f.bookingId)).status, 202); const stored = await cancelled(f, true);
      assert.equal(stored.refunds.length, 1); assert.equal(stored.refunds[0].amountPaise, 25700n);
      assert.equal(stored.refunds[0].attempts.length, 1); assert.equal(stored.refunds[0].attempts[0].providerRefundId, null);
      assert.ok(stored.refunds[0].attempts[0].lastErrorCode); assert.deepEqual(contractErrors, []);
      const rebook = await create(f.showId, otherToken); assert.equal(rebook.status, 201, JSON.stringify(rebook.body));
      const availability = await request(app).get(`/api/shows/${f.showId}/availability`);
      assert.equal(availability.status, 200); assert.ok(availability.body.data.seats.every(seat => seat.availability === 'LOCKED'));
      outages.delete(f.value.id); assert.equal((await retry(f.bookingId)).status, 200); await cancelled(f);
      assert.equal(await redis.exists(seatIds.map(id => key(f.showId, id))), 2, 'Refund retry must preserve another customer hold.');
    });
    await t.test('Redis outage cannot prevent paid cancellation or full refund', async () => {
      const f = await fresh(); markCancelling(f); redis.destroy();
      try { assert.equal((await cancel(f.bookingId)).status, 200); await cancelled(f); }
      finally { await redis.connect(); }
    });
    await t.test('lost refund acknowledgement retries the identical persisted UUID header, body and receipt', async () => {
      const f = await fresh(); markCancelling(f); lostAcknowledgements.add(f.value.id);
      assert.equal((await cancel(f.bookingId)).status, 202); await cancelled(f, true);
      const initial = await refundFor(f.value.id); assert.equal(initial.attempts[0].providerRefundId, null);
      const before = refundKeys.size; assert.equal((await retry(f.bookingId)).status, 200); await cancelled(f);
      const calls = requests.filter(value => value.paymentId === f.value.id);
      assert.equal(calls.length, 2); assert.equal(calls[0].key, initial.attempts[0].id); assert.deepEqual(calls[0], calls[1]);
      assert.equal(refundKeys.size, before); assert.equal((await refundFor(f.value.id)).attempts.length, 1); assert.deepEqual(contractErrors, []);
    });
    await t.test('signed raw refund webhook before local acknowledgement attaches reserved receipt and cannot regress processed state', async () => {
      const f = await fresh(); markCancelling(f); createStatus.set(f.value.id, 'pending');
      beforeAttach.set(f.value.id, async providerRefund => {
        const local = await refundFor(f.value.id); assert.equal(local.attempts[0].providerRefundId, null);
        const processed = { ...providerRefund, status: 'processed' }; providerRefunds.set(processed.id, processed);
        const result = await webhook(processed, 'refund.processed'); assert.equal(result.status, 200, JSON.stringify(result.body));
      });
      const result = await cancel(f.bookingId); assert.equal(result.status, 200, JSON.stringify(result.body));
      const stored = await cancelled(f); assert.equal(stored.refunds[0].attempts[0].status, 'PROCESSED');
      assert.ok(stored.refunds[0].attempts[0].processedAt); assert.equal(stored.refunds[0].attempts.length, 1);
    });
    await t.test('pending refund uses authoritative fetch rather than starting another attempt', async () => {
      const f = await fresh(); markCancelling(f); createStatus.set(f.value.id, 'pending');
      assert.equal((await cancel(f.bookingId)).status, 202); const first = await refundFor(f.value.id);
      assert.equal((await retry(f.bookingId)).status, 202); assert.equal((await refundFor(f.value.id)).attempts.length, 1);
      assert.equal(requests.filter(call => call.paymentId === f.value.id).length, 1);
      const value = providerRefundFor(f.value.id); providerRefunds.set(value.id, { ...value, status: 'processed' });
      assert.equal((await retry(f.bookingId)).status, 200); await cancelled(f);
      assert.equal((await refundFor(f.value.id)).attempts[0].id, first.attempts[0].id);
    });
    await t.test('failed attempt cannot advance during fetch outage; concurrent authoritative retries create one next attempt', async () => {
      const f = await fresh(); markCancelling(f); createStatus.set(f.value.id, 'failed');
      assert.equal((await cancel(f.bookingId)).status, 202); const initial = await refundFor(f.value.id), failed = providerRefundFor(f.value.id);
      assert.equal(initial.attempts[0].status, 'FAILED'); fetchOutages.add(failed.id); createStatus.set(f.value.id, 'processed');
      assert.equal((await retry(f.bookingId)).status, 202); assert.equal((await refundFor(f.value.id)).attempts.length, 1);
      assert.equal(requests.filter(call => call.paymentId === f.value.id).length, 1); fetchOutages.delete(failed.id);
      const responses = await Promise.all([retry(f.bookingId), retry(f.bookingId), retry(f.bookingId)]);
      assert.ok(responses.every(result => result.status === 200 || result.status === 202), JSON.stringify(responses.map(result => result.body)));
      await cancelled(f); const current = await refundFor(f.value.id); assert.equal(current.attempts.length, 2);
      assert.deepEqual(current.attempts.map(value => value.sequence), [1, 2]); assert.notEqual(current.attempts[1].id, initial.attempts[0].id);
      assert.equal(current.attempts[0].status, 'FAILED'); assert.equal(current.attempts[1].status, 'PROCESSED');
      const effects = [...providerRefunds.values()].filter(value => value.payment_id === f.value.id && value.status === 'processed'); assert.equal(effects.length, 1);
      const posts = requests.filter(call => call.paymentId === f.value.id); const secondPost = requests.indexOf(posts.find(call => call.key === current.attempts[1].id));
      assert.ok(requests.slice(0, secondPost).some(call => call.method === 'GET' && call.id === failed.id));
    });
    await t.test('processed provider state wins over stale local failed evidence without a new money request', async () => {
      const f = await fresh(); markCancelling(f); createStatus.set(f.value.id, 'failed');
      assert.equal((await cancel(f.bookingId)).status, 202); const failed = providerRefundFor(f.value.id);
      providerRefunds.set(failed.id, { ...failed, status: 'processed' }); assert.equal((await retry(f.bookingId)).status, 200); await cancelled(f);
      assert.equal((await refundFor(f.value.id)).attempts.length, 1); assert.equal(requests.filter(call => call.paymentId === f.value.id).length, 1);
    });
    await t.test('processed webhook between failed fetch and retry reservation suppresses the next money request', async () => {
      const f = await fresh(); markCancelling(f); createStatus.set(f.value.id, 'failed');
      assert.equal((await cancel(f.bookingId)).status, 202); const failed = providerRefundFor(f.value.id);
      const original = refundsStore.retryAttempt.bind(refundsStore); let crossed = false;
      refundsStore.retryAttempt = async (id, failedProviderId) => {
        crossed = true;
        const processed = { ...failed, status: 'processed' }; providerRefunds.set(failed.id, processed);
        assert.equal((await webhook(processed, 'refund.processed')).status, 200);
        return original(id, failedProviderId);
      };
      try { assert.equal((await retry(f.bookingId)).status, 200); }
      finally { refundsStore.retryAttempt = original; }
      assert.equal(crossed, true); await cancelled(f);
      assert.equal((await refundFor(f.value.id)).attempts.length, 1);
      assert.equal(requests.filter(call => call.paymentId === f.value.id).length, 1);
    });
    await t.test('processed refund dominates delayed failed/created events; identical event replay is harmless and changed event identity conflicts', async () => {
      const f = await fresh(); markCancelling(f); createStatus.set(f.value.id, 'pending'); assert.equal((await cancel(f.bookingId)).status, 202);
      const pending = providerRefundFor(f.value.id), processed = { ...pending, status: 'processed' }, eventId = providerId('evt');
      providerRefunds.set(processed.id, processed);
      assert.equal((await webhook(processed, 'refund.processed', eventId)).status, 200); await cancelled(f);
      const timestamp = (await refundFor(f.value.id)).attempts[0].processedAt;
      assert.equal((await webhook(processed, 'refund.processed', eventId)).status, 200);
      assert.equal((await webhook({ ...pending, status: 'failed' }, 'refund.failed')).status, 200);
      assert.equal((await webhook(pending, 'refund.created')).status, 200); await cancelled(f);
      assert.deepEqual((await refundFor(f.value.id)).attempts[0].processedAt, timestamp);
      assert.equal((await webhook({ ...pending, status: 'failed' }, 'refund.failed', eventId)).status, 409);
      const ledger = await prisma.paymentWebhookEvent.findUnique({ where: { providerEventId: eventId } });
      assert.equal(ledger.providerRefundId, processed.id); assert.ok(ledger.processedAt);
    });
    await t.test('untrusted refund signatures, amount/currency/source/receipt forgeries cannot complete a pending refund', async () => {
      const f = await fresh(); markCancelling(f); createStatus.set(f.value.id, 'pending'); assert.equal((await cancel(f.bookingId)).status, 202);
      const current = providerRefundFor(f.value.id), processed = { ...current, status: 'processed' };
      assert.equal((await webhook(processed, 'refund.processed', undefined, '0'.repeat(64))).status, 400);
      for (const forged of [{ amount: 1 }, { currency: 'USD' }, { payment_id: providerId('pay') }, { receipt: randomUUID() }, { id: providerId('rfnd') }]) {
        const response = await webhook({ ...processed, ...forged }, 'refund.processed');
        assert.equal(response.status, 400, JSON.stringify(response.body)); await cancelled(f, true);
      }
      assert.equal((await refundFor(f.value.id)).attempts[0].status, 'PENDING');
    });
    await t.test('concurrent cancellation and old capture/failure replays never reset refund progress or reacquire allocations', async () => {
      const f = await fresh(); markCancelling(f); createStatus.set(f.value.id, 'pending');
      const responses = await Promise.all([cancel(f.bookingId), cancel(f.bookingId), cancel(f.bookingId)]);
      assert.ok(responses.every(value => value.status === 202)); const initial = await cancelled(f, true); assert.equal(initial.refunds.length, 1);
      assert.equal((await verify(f.bookingId, f.value)).status, 200);
      assert.equal((await webhook(f.value)).status, 200); assert.equal((await webhook(f.value, 'order.paid')).status, 200);
      assert.equal((await webhook({ ...f.value, status: 'failed', captured: false }, 'payment.failed')).status, 200); await cancelled(f, true);
      const current = providerRefundFor(f.value.id); providerRefunds.set(current.id, { ...current, status: 'processed' });
      assert.equal((await webhook({ ...current, status: 'processed' }, 'refund.processed')).status, 200);
      assert.equal((await verify(f.bookingId, f.value)).status, 200); assert.equal((await cancel(f.bookingId)).status, 200); await cancelled(f);
      assert.equal((await refundFor(f.value.id)).attempts.length, 1); assert.equal(refundKeys.has(initial.refunds[0].attempts[0].id), true);
    });
    await t.test('stale payment.failed after a fully returned cancellation cannot downgrade financial status or captured history', async () => {
      const f = await fresh(); markCancelling(f); assert.equal((await cancel(f.bookingId)).status, 200);
      const before = await cancelled(f), result = await webhook({ ...f.value, status: 'failed', captured: false }, 'payment.failed');
      assert.equal(result.status, 200, JSON.stringify(result.body)); const after = await cancelled(f);
      assert.deepEqual(after.capturedAt, before.capturedAt); assert.equal(after.refunds[0].attempts[0].status, 'PROCESSED');
      assert.equal(after.evidence.find(value => value.providerPaymentId === f.value.id).captured, true);
      assert.equal(after.evidence.find(value => value.providerPaymentId === f.value.id).failureSeen, true);
    });
    await t.test('fetched refunded state for a known returned source refreshes without fulfillment or another refund', async () => {
      const f = await fresh(); markCancelling(f); assert.equal((await cancel(f.bookingId)).status, 200);
      providerPayments.set(f.value.id, { ...f.value, status: 'refunded', captured: true });
      const prior = await refundFor(f.value.id), result = await verify(f.bookingId, f.value);
      assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.data.payment.status, 'REFUNDED');
      assert.ok(result.body.data.payment.reconciliation.resolvedAt); await cancelled(f);
      assert.equal((await refundFor(f.value.id)).attempts[0].id, prior.attempts[0].id);
    });
    await t.test('cancel/rebook and payment replay races produce one replacement ticket without reviving the original', async () => {
      const f = await fresh(); markCancelling(f); assert.equal((await cancel(f.bookingId)).status, 200);
      const responses = await Promise.all([create(f.showId), create(f.showId, otherToken), verify(f.bookingId, f.value), webhook(f.value)]);
      const winners = responses.slice(0, 2).filter(value => value.status === 201); assert.equal(winners.length, 1);
      assert.equal(responses.slice(0, 2).filter(value => value.status === 409).length, 1);
      const winner = winners[0].body.data.booking, bearer = winner.id === responses[0].body?.data?.booking?.id ? token : otherToken;
      const ordered = await ownerPost('/api/payments/order', { bookingId: winner.id }, bearer); assert.equal(ordered.status, 201);
      const value = capture(orders.get(ordered.body.data.order.id)); assert.equal((await webhook(value)).status, 200);
      assert.equal((await prisma.booking.findUnique({ where: { id: f.bookingId } })).status, 'CANCELLED');
      assert.equal((await prisma.booking.findUnique({ where: { id: winner.id } })).status, 'CONFIRMED');
      assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId } }), 2);
      assert.equal(await prisma.refund.count({ where: { providerPaymentId: f.value.id } }), 1);
    });
    await t.test('released unpaid booking gets full captured compensation and never revives on verification replay', async () => {
      const f = await fresh(false); assert.equal((await request(app).delete(`/api/bookings/${f.bookingId}/hold`).set('Authorization', `Bearer ${token}`)).status, 200);
      assert.equal((await verify(f.bookingId, f.value)).status, 200);
      const result = await financial(f.bookingId); assert.equal(result.status, 'REFUNDED'); assert.equal(result.refunds[0].amountPaise, 25700n);
      assert.equal(result.reconciliation.compensationRequired, true); assert.ok(result.reconciliation.resolvedAt);
      assert.equal((await prisma.booking.findUnique({ where: { id: f.bookingId } })).status, 'CANCELLED');
      assert.equal((await webhook(f.value)).status, 200); assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId } }), 0);
    });
    await t.test('capture for a never fulfilled expired ticket after showtime gets full compensation with no allocation revival', async () => {
      const showId = await newShow(new Date(Date.now() + 2000)), bookingId = randomUUID(); bookingIds.push(bookingId);
      // Create a valid historical pending ticket before showtime, then let the
      // database clock cross showtime before delivering the captured payment.
      await prisma.$transaction(async tx => {
        await tx.booking.create({ data: { id: bookingId, showId, userId, expiresAt: new Date('2019-12-31'), totalPaise: 25000n } });
        await tx.bookingSeat.createMany({ data: seatIds.map((seatId, index) => ({ id: randomUUID(), bookingId, showId, seatId, price: index ? 15000 : 10000 })) });
      });
      const id = randomUUID(); await prisma.payment.create({ data: { id, bookingId, receipt: id, amountPaise: 25000n } });
      const ordered = await provider.createOrder({ receipt: id, amountPaise: 25000, currency: 'INR' }); await paymentsStore.attachOrder(id, ordered);
      await prisma.$executeRaw`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM (starts_at-clock_timestamp()))+0.02)) FROM shows WHERE id=${showId}::uuid`;
      const value = capture(orders.get(ordered.id)); assert.equal((await webhook(value)).status, 200);
      const result = await financial(bookingId); assert.equal(result.status, 'REFUNDED'); assert.equal(result.refunds[0].amountPaise, 25000n);
      assert.equal((await prisma.booking.findUnique({ where: { id: bookingId } })).status, 'FAILED');
      assert.equal(await prisma.confirmedSeat.count({ where: { showId } }), 0); assert.equal((await retry(bookingId)).status, 200);
    });
    await t.test('duplicate captures refund only extra sources and preserve legitimate confirmed funding and ticket', async () => {
      const f = await fresh(), extra = capture(f.order), extra2 = capture(f.order);
      const responses = await Promise.all([webhook(extra), webhook(extra), webhook(extra2)]); assert.ok(responses.every(value => value.status === 200));
      const result = await financial(f.bookingId); assert.equal(result.status, 'SUCCESS'); assert.equal(result.providerPaymentId, f.value.id);
      assert.equal((await prisma.booking.findUnique({ where: { id: f.bookingId } })).status, 'CONFIRMED');
      assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId } }), 2);
      assert.equal(result.refunds.length, 2); assert.deepEqual(new Set(result.refunds.map(value => value.providerPaymentId)), new Set([extra.id, extra2.id]));
      assert.ok(result.refunds.every(value => value.status === 'REFUNDED' && value.amountPaise === 25700n));
      assert.equal(await prisma.refund.count({ where: { providerPaymentId: f.value.id } }), 0);
      assert.equal((await verify(f.bookingId, f.value)).status, 200); assert.equal((await financial(f.bookingId)).status, 'SUCCESS');
    });
    await t.test('extra capture after full cancellation refund creates a new full source obligation without reopening seats', async () => {
      const f = await fresh(); markCancelling(f); assert.equal((await cancel(f.bookingId)).status, 200); await cancelled(f);
      const first = await refundFor(f.value.id), extra = capture(f.order); outages.add(extra.id);
      assert.equal((await webhook(extra)).status, 200); const pending = await cancelled(f, true);
      assert.equal(pending.refunds.length, 2); assert.equal((await refundFor(f.value.id)).status, 'REFUNDED');
      assert.equal((await refundFor(extra.id)).status, 'PENDING'); outages.delete(extra.id);
      assert.equal((await retry(f.bookingId)).status, 200); const result = await cancelled(f);
      assert.equal(result.refunds.length, 2); assert.equal(result.refunds.reduce((sum, value) => sum + value.amountPaise, 0n), 51400n);
      assert.equal((await refundFor(f.value.id)).attempts[0].id, first.attempts[0].id);
      assert.equal((await webhook(extra)).status, 200); assert.equal((await financial(f.bookingId)).refunds.length, 2);
    });
    await t.test('cancellation rollback releases no allocations, persists no obligation and makes no refund HTTP request', async () => {
      const f = await fresh(), before = requests.filter(value => value.paymentId === f.value.id).length;
      const original = prisma.$transaction;
      prisma.$transaction = (work, options) => typeof work === 'function' ? original(async tx => {
        const result = await work(tx);
        if ((await tx.booking.findUnique({ where: { id: f.bookingId } }))?.status === 'CANCELLED') throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Injected cancellation commit failure');
        return result;
      }, options) : original(work, options);
      try { assert.equal((await cancel(f.bookingId)).status, 503); }
      finally { prisma.$transaction = original; }
      const result = await financial(f.bookingId); assert.equal(result.status, 'SUCCESS'); assert.equal(result.refunds.length, 0);
      assert.equal((await prisma.booking.findUnique({ where: { id: f.bookingId } })).status, 'CONFIRMED');
      assert.equal(await prisma.confirmedSeat.count({ where: { showId: f.showId } }), 2);
      assert.equal(requests.filter(value => value.paymentId === f.value.id).length, before);
    });
    await t.test('availability reads inspect a cancelled-and-reheld seat that was initially permanently allocated', async () => {
      const f = await fresh(); markCancelling(f); const locks = new SeatLockService(redis); let raced = false;
      const racingLocks = { acquire: locks.acquire.bind(locks), release: locks.release.bind(locks), validate: locks.validate.bind(locks),
        inspect: async (showId, inspectedIds) => {
          if (!raced) { raced = true; assert.equal((await cancel(f.bookingId)).status, 200); assert.equal((await create(f.showId, otherToken)).status, 201); }
          return locks.inspect(showId, inspectedIds);
        } };
      const selectedBooking = { bookings: new BookingService(new BookingRepository(prisma), racingLocks) };
      const result = await request(appFor(refunds, selectedBooking)).get(`/api/shows/${f.showId}/availability`);
      assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(raced, true);
      assert.ok(result.body.data.seats.every(seat => seat.availability === 'LOCKED'), JSON.stringify(result.body));
    });
    await t.test('auth, foreign ownership, strict empty input and current admin role protect financial routes', async () => {
      const f = await fresh();
      for (const path of [`/api/bookings/${f.bookingId}/cancel`, `/api/bookings/${f.bookingId}/refund/retry`, '/api/admin/refunds/reconcile']) {
        assert.equal((await request(app).post(path).send({})).status, 401);
        for (const body of [{ amountPaise: 1 }, { paid: true }, { status: 'REFUNDED' }, { refundId: randomUUID() }, { providerPaymentId: f.value.id }]) {
          assert.equal((await ownerPost(path, body, path.startsWith('/api/admin') ? adminToken : token)).status, 400);
        }
      }
      assert.equal((await ownerPost(`/api/bookings/${f.bookingId}/cancel`, {}, otherToken)).status, 404);
      assert.equal((await ownerPost(`/api/bookings/${f.bookingId}/refund/retry`, {}, otherToken)).status, 404);
      assert.equal((await request(app).get(`/api/bookings/${f.bookingId}/refunds`).set('Authorization', `Bearer ${otherToken}`)).status, 404);
      assert.equal((await request(app).get(`/api/bookings/${f.bookingId}/refunds`)).status, 401);
      assert.equal((await ownerPost('/api/admin/refunds/reconcile')).status, 403);
      const forgedRole = tokens.sign({ userId, role: 'ADMIN' }); assert.equal((await ownerPost('/api/admin/refunds/reconcile', {}, forgedRole)).status, 403);
      assert.equal((await ownerPost('/api/bookings/not-a-uuid/cancel')).status, 400);
      const pending = await fresh(false); assert.equal((await cancel(pending.bookingId)).status, 409);
      assert.equal((await financial(f.bookingId)).status, 'SUCCESS'); assert.equal((await financial(f.bookingId)).refunds.length, 0);
    });
    await t.test('bounded administrator recovery rotates past pending sources instead of starving the twenty-first obligation', async () => {
      const backlog = [];
      for (let index = 0; index < 21; index++) {
        const f = await fresh(); markCancelling(f); createStatus.set(f.value.id, 'pending');
        assert.equal((await cancel(f.bookingId)).status, 202);
        const payment = await financial(f.bookingId);
        await prisma.payment.update({ where: { id: payment.id }, data: { updatedAt: new Date(Date.UTC(2001, 0, 1) + index) } });
        backlog.push(f);
      }
      const last = backlog.at(-1); providerRefundFor(last.value.id).status = 'processed';
      const first = await ownerPost('/api/admin/refunds/reconcile', {}, adminToken);
      assert.equal(first.status, 200); assert.equal(first.body.data.examined, 20);
      assert.equal((await financial(last.bookingId)).status, 'REFUND_PENDING');
      const second = await ownerPost('/api/admin/refunds/reconcile', {}, adminToken);
      assert.equal(second.status, 200); assert.equal(second.body.data.examined, 20);
      assert.equal((await financial(last.bookingId)).status, 'REFUNDED', 'A pending older batch must not indefinitely hide a recoverable later refund.');
      assert.equal((await refundFor(last.value.id)).attempts.length, 1);
    });
    await t.test('administrator reconciliation recovers the durable backlog after provider recovery', async () => {
      const f = await fresh(); markCancelling(f); outages.add(f.value.id); assert.equal((await cancel(f.bookingId)).status, 202);
      const initial = await refundFor(f.value.id); outages.delete(f.value.id);
      const result = await ownerPost('/api/admin/refunds/reconcile', {}, adminToken); assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.ok(result.body.data.examined >= 1);
      // The preceding regression deliberately leaves more than one batch pending.
      // Recovery is bounded/fair, not a promise that every new item is first.
      for (let batch = 0; batch < 2 && (await financial(f.bookingId)).status !== 'REFUNDED'; batch++) {
        assert.equal((await ownerPost('/api/admin/refunds/reconcile', {}, adminToken)).status, 200);
      }
      await cancelled(f); assert.equal((await refundFor(f.value.id)).attempts[0].id, initial.attempts[0].id);
      await prisma.user.update({ where: { id: adminId }, data: { role: 'USER' } });
      assert.equal((await ownerPost('/api/admin/refunds/reconcile', {}, adminToken)).status, 403);
    });
    assert.deepEqual(contractErrors, []);
  } finally {
    // No resets or global Redis deletion. Native refund guards prohibit deletion
    // at runtime; disable triggers only for exact fixture IDs in this validated,
    // loopback *_test database, using a transaction-scoped setting.
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      const paymentWhere = { bookingId: { in: bookingIds } }, childWhere = { payment: paymentWhere };
      await tx.refundAttempt.deleteMany({ where: { refund: childWhere } });
      await tx.refund.deleteMany({ where: childWhere });
      await tx.paymentWebhookEvent.deleteMany({ where: { OR: [childWhere, { providerEventId: { in: eventIds } }] } });
      await tx.paymentReconciliation.deleteMany({ where: childWhere });
      await tx.paymentEvidence.deleteMany({ where: childWhere });
      await tx.payment.deleteMany({ where: paymentWhere });
      await tx.confirmedSeat.deleteMany({ where: { bookingSeat: { bookingId: { in: bookingIds } } } });
      await tx.bookingSeat.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.booking.deleteMany({ where: { id: { in: bookingIds } } });
      await tx.showSeatPrice.deleteMany({ where: { showId: { in: showIds } } });
      await tx.show.deleteMany({ where: { id: { in: showIds } } });
      await tx.seat.deleteMany({ where: { id: { in: seatIds } } });
      await tx.screen.deleteMany({ where: { id: screenId } }); await tx.theatre.deleteMany({ where: { id: theatreId } });
      await tx.city.deleteMany({ where: { id: cityId } }); await tx.movie.deleteMany({ where: { id: movieId } });
      await tx.firstBookingOffer.deleteMany({where:{userId:{in:[userId,otherUserId,adminId]}}});
      await tx.pricingTaxPolicy.deleteMany({where:{key:`movie:${theatreId}:integration-ticket-only`}});
      await tx.user.deleteMany({ where: { id: { in: [userId, otherUserId, adminId] } } });
    }, { timeout: 15000 });
    if (!redis.isOpen) await redis.connect();
    if (showIds.length) await redis.del(showIds.flatMap(showId => seatIds.map(seatId => key(showId, seatId))));
    if (redis.isOpen) redis.destroy(); await prisma.$disconnect();
  }
});
