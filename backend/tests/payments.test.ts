import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { checkoutSignature, paymentFixture, webhookSignature } from './helpers/payments.js';
import type { ProviderPayment } from '../src/modules/payments/payment-provider.js';
import { AppError } from '../src/errors/app-error.js';

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;
const postOrder = (f: Fixture, bookingId: string, bearer = f.token) => request(f.app).post('/api/payments/order')
  .set('Authorization', `Bearer ${bearer}`).send({ bookingId });
const verify = (f: Fixture, bookingId: string, value: ProviderPayment, overrides: object = {}, bearer = f.token) => request(f.app)
  .post('/api/payments/verify').set('Authorization', `Bearer ${bearer}`).send({ bookingId, razorpay_order_id: value.orderId,
    razorpay_payment_id: value.id, razorpay_signature: checkoutSignature(value.orderId, value.id), ...overrides });
const webhook = (f: Fixture, raw: Buffer, eventId = `evt_${randomUUID()}`, signature = webhookSignature(raw)) => request(f.app)
  .post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', signature)
  .set('x-razorpay-event-id', eventId).send(raw.toString('utf8'));
async function fixtureOrder() {
  const f = await paymentFixture();
  const created = await request(f.app).post('/api/bookings').set('Authorization', `Bearer ${f.token}`)
    .send({ showId: f.show.id, seatIds: f.seats.map(seat => seat.id) });
  expect(created.status).toBe(201);
  const bookingId: string = created.body.data.booking.id;
  const response = await postOrder(f, bookingId); expect(response.status).toBe(201);
  const order = f.providerOrders.get(response.body.data.order.id)!;
  return { ...f, bookingId, order, orderResponse: response };
}

describe('payment HTTP and real service financial/fulfillment policy', () => {
  it('creates an order using the immutable server-priced amount and only the public key', async () => {
    const f = await fixtureOrder();
    expect(f.orderResponse.body.data.order).toMatchObject({ id: f.order.id, amountPaise: 25000, currency: 'INR', keyId: 'rzp_test_local_payment_fixture' });
    expect(f.orderResponse.body.data.payment).toMatchObject({ bookingId: f.bookingId, status: 'PENDING' });
    expect(f.payments.size).toBe(1);
    expect(JSON.stringify(f.orderResponse.body)).not.toContain('payment-provider-test-only-secret');
    expect(JSON.stringify(f.orderResponse.body)).not.toContain('payment-webhook-test-only-secret');
  });
  it('reuses the same order after repeated authenticated requests', async () => {
    const f = await fixtureOrder(); const repeated = await postOrder(f, f.bookingId); expect(repeated.status).toBe(201);
    expect(repeated.body.data.order.id).toBe(f.order.id); expect(f.payments.size).toBe(1); expect(f.providerOrders.size).toBe(1);
  });
  it('recovers an externally created order after its acknowledgement is lost by its stable receipt', async () => {
    const f = await paymentFixture(); const booking = await f.bookingService.create(f.userId, { showId: f.show.id, seatIds: f.seats.map(seat => seat.id) });
    f.paymentState.loseOrderAck = true; const first = await postOrder(f, booking.id); expect([201, 503]).toContain(first.status);
    const retried = await postOrder(f, booking.id); expect(retried.status).toBe(201);
    expect(f.providerOrders.size).toBe(1); expect(f.payments.size).toBe(1); expect([...f.providerOrders.values()][0]!.amountPaise).toBe(25000);
  });
  it('requires a current user and hides another user booking and verification', async () => {
    const f = await fixtureOrder();
    expect((await request(f.app).post('/api/payments/order').send({ bookingId: f.bookingId })).status).toBe(401);
    expect((await postOrder(f, f.bookingId, f.otherToken)).status).toBe(404);
    const value = f.payment(f.order); expect((await verify(f, f.bookingId, value, {}, f.otherToken)).status).toBe(404);
    f.users.delete(f.userId); expect((await postOrder(f, f.bookingId)).status).toBe(401); expect(f.allocations.size).toBe(0);
  });
  it.each([{ amountPaise: 1 }, { totalPaise: 1 }, { paid: true }, { userId: randomUUID() }])('rejects client financial or identity fields: %j', async extra => {
    const f = await fixtureOrder(); const response = await request(f.app).post('/api/payments/order').set('Authorization', `Bearer ${f.token}`).send({ bookingId: f.bookingId, ...extra });
    expect(response.status).toBe(400); expect(f.providerOrders.size).toBe(1);
  });
  it('rejects malformed booking identifiers before reserving a payment', async () => {
    const f = await paymentFixture(); expect((await postOrder(f, 'not-a-uuid')).status).toBe(400); expect(f.payments.size).toBe(0);
  });
  it('keeps authentic authorization PENDING until actual capture', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order, { status: 'authorized', captured: false });
    const response = await verify(f, f.bookingId, value); expect(response.status).toBe(200);
    expect(response.body.data.payment.status).toBe('PENDING'); expect(f.records.get(f.bookingId)!.status).toBe('PENDING'); expect(f.allocations.size).toBe(0);
  });
  it('confirms once only after signature and captured provider state verification', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order); const response = await verify(f, f.bookingId, value); expect(response.status).toBe(200);
    expect(response.body.data.payment.status).toBe('SUCCESS'); expect(f.records.get(f.bookingId)!.status).toBe('CONFIRMED');
    expect(f.evidence.size).toBe(1); expect(f.allocations.size).toBe(2); expect(f.holds.size).toBe(0);
    expect((await verify(f, f.bookingId, value)).status).toBe(200); expect(f.allocations.size).toBe(2); expect(f.evidence.size).toBe(1);
    expect((await request(f.app).post(`/api/bookings/${f.bookingId}/confirm`).set('Authorization', `Bearer ${f.token}`).send({ paid: true })).status).toBe(404);
  });
  it('rejects a forged checkout signature before capture evidence', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order);
    expect((await verify(f, f.bookingId, value, { razorpay_signature: '0'.repeat(64) })).status).toBe(400);
    expect(f.evidence.size).toBe(0); expect(f.allocations.size).toBe(0);
  });
  it.each([{ amountPaise: 24999 }, { currency: 'USD' }, { orderId: 'order_foreign0001' }, { id: 'pay_foreign0001' }])('rejects captured provider identity or money mismatch: %j', async override => {
    const f = await fixtureOrder(); const value = f.payment(f.order); f.providerPayments.set(value.id, { ...value, ...override });
    const response = await verify(f, f.bookingId, value);
    expect(response.status).toBeGreaterThanOrEqual(400); expect(response.status).toBeLessThan(500);
    expect(f.evidence.size).toBe(0); expect(f.allocations.size).toBe(0); expect([...f.payments.values()][0]!.status).toBe('PENDING');
  });
  it('fulfills a captured webhook without any browser callback', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order); expect((await webhook(f, f.rawWebhook(value))).status).toBe(200);
    expect([...f.payments.values()][0]!.status).toBe('SUCCESS'); expect(f.records.get(f.bookingId)!.status).toBe('CONFIRMED');
    expect(f.allocations.size).toBe(2); expect(f.events.size).toBe(1); expect([...f.events.values()][0]!.processedAt).not.toBeNull();
  });
  it('accepts the exact signed whitespace-bearing raw bytes before JSON parsing', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order); const raw = Buffer.from(`${f.rawWebhook(value).toString('utf8')}\n`);
    expect((await webhook(f, raw)).status).toBe(200); expect(f.records.get(f.bookingId)!.status).toBe('CONFIRMED');
  });
  it('rejects forged webhook bytes without financial or fulfillment writes', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order);
    expect((await webhook(f, f.rawWebhook(value), `evt_${randomUUID()}`, '0'.repeat(64))).status).toBe(400);
    expect(f.events.size).toBe(0); expect(f.evidence.size).toBe(0); expect(f.allocations.size).toBe(0);
  });
  it('deduplicates capture arriving through concurrent verify, captured and order-paid events', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order); const eventId = `evt_${randomUUID()}`;
    const responses = await Promise.all([verify(f, f.bookingId, value), webhook(f, f.rawWebhook(value), eventId), webhook(f, f.rawWebhook(value), eventId),
      webhook(f, f.rawWebhook(value, 'order.paid', { ...f.order, status: 'paid' }))]);
    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200]);
    expect(f.evidence.size).toBe(1); expect(f.payments.size).toBe(1); expect(f.allocations.size).toBe(2); expect([...f.payments.values()][0]!.reconciliation).toBeNull();
  });
  it('does not downgrade capture after a delayed failed event', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order); expect((await webhook(f, f.rawWebhook(value))).status).toBe(200);
    expect((await webhook(f, f.rawWebhook({ ...value, status: 'failed', captured: false }, 'payment.failed'))).status).toBe(200);
    expect([...f.payments.values()][0]!.status).toBe('SUCCESS'); expect(f.records.get(f.bookingId)!.status).toBe('CONFIRMED'); expect(f.allocations.size).toBe(2);
  });
  it('corrects earlier failed financial evidence on capture without reviving a released Booking', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order, { status: 'failed', captured: false });
    expect((await webhook(f, f.rawWebhook(value, 'payment.failed'))).status).toBe(200); expect([...f.payments.values()][0]!.status).toBe('FAILED');
    await f.bookingService.releaseHold(f.userId, f.bookingId);
    const captured = f.payment(f.order, { id: value.id, status: 'captured', captured: true }); expect((await webhook(f, f.rawWebhook(captured))).status).toBe(200);
    expect([...f.payments.values()][0]!).toMatchObject({ status: 'SUCCESS', reconciliation: { compensationRequired: true } });
    expect(f.records.get(f.bookingId)!.status).toBe('CANCELLED'); expect(f.allocations.size).toBe(0); expect(f.state.acquires).toBe(1);
  });
  it.each(['expired', 'lost', 'released'] as const)('preserves capture with compensation required after a %s hold', async scenario => {
    const f = await fixtureOrder(); const value = f.payment(f.order);
    if (scenario === 'expired') f.state.now = new Date('2030-01-01T00:06:00Z');
    if (scenario === 'lost') f.holds.clear();
    if (scenario === 'released') await f.bookingService.releaseHold(f.userId, f.bookingId);
    expect((await webhook(f, f.rawWebhook(value))).status).toBe(200);
    expect([...f.payments.values()][0]!).toMatchObject({ status: 'SUCCESS', reconciliation: { compensationRequired: true } });
    expect(f.records.get(f.bookingId)!.status).toBe(scenario === 'released' ? 'CANCELLED' : 'FAILED'); expect(f.allocations.size).toBe(0); expect(f.state.acquires).toBe(1);
  });
  it('keeps SUCCESS and unfinished fulfillment retryable during Redis outage', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order); const raw = f.rawWebhook(value); const eventId = `evt_${randomUUID()}`;
    f.state.redisDown = true; expect((await webhook(f, raw, eventId)).status).toBe(503);
    expect([...f.payments.values()][0]!).toMatchObject({ status: 'SUCCESS', bookingFinalizedAt: null, reconciliation: { reason: 'FULFILLMENT_PENDING', compensationRequired: false } });
    expect(f.records.get(f.bookingId)!.status).toBe('PENDING'); expect(f.events.get(eventId)!.processedAt).toBeNull();
    f.state.redisDown = false; expect((await webhook(f, raw, eventId)).status).toBe(200);
    expect(f.records.get(f.bookingId)!.status).toBe('CONFIRMED'); expect(f.allocations.size).toBe(2); expect(f.evidence.size).toBe(1);
  });
  it('persists capture before final database failure and retries finalization', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order); const raw = f.rawWebhook(value); const eventId = `evt_${randomUUID()}`;
    f.paymentState.failFinalize = true; expect((await webhook(f, raw, eventId)).status).toBe(503);
    expect([...f.payments.values()][0]!.status).toBe('SUCCESS'); expect(f.records.get(f.bookingId)!.status).toBe('PENDING'); expect(f.holds.size).toBe(2); expect(f.allocations.size).toBe(0);
    f.paymentState.failFinalize = false; expect((await webhook(f, raw, eventId)).status).toBe(200);
    expect(f.records.get(f.bookingId)!.status).toBe('CONFIRMED'); expect(f.evidence.size).toBe(1); expect(f.allocations.size).toBe(2);
  });
  it('keeps a captured payment retryable after a mapped database concurrency conflict', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order); const raw = f.rawWebhook(value); const eventId = `evt_${randomUUID()}`;
    const transition = f.store.transition;
    f.store.transition = async () => { throw new AppError(409, 'CONCURRENT_CHANGE', 'A concurrent change occurred. Retry the request.'); };
    const first = await webhook(f, raw, eventId);
    expect(first.status).toBe(409); expect(first.body.error.code).toBe('CONCURRENT_CHANGE');
    expect([...f.payments.values()][0]!).toMatchObject({ status: 'SUCCESS', bookingFinalizedAt: null,
      reconciliation: { reason: 'FULFILLMENT_PENDING', compensationRequired: false } });
    expect(f.records.get(f.bookingId)!.status).toBe('PENDING'); expect(f.holds.size).toBe(2); expect(f.allocations.size).toBe(0);
    expect(f.events.get(eventId)!.processedAt).toBeNull();
    f.store.transition = transition;
    expect((await webhook(f, raw, eventId)).status).toBe(200);
    expect(f.records.get(f.bookingId)!.status).toBe('CONFIRMED'); expect(f.evidence.size).toBe(1); expect(f.allocations.size).toBe(2);
  });
  it('replays safely after committed finalization loses its acknowledgement', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order); const raw = f.rawWebhook(value); const eventId = `evt_${randomUUID()}`;
    f.paymentState.loseFinalizeAck = true; const first = await webhook(f, raw, eventId); expect([200, 503]).toContain(first.status);
    expect([...f.payments.values()][0]!.status).toBe('SUCCESS'); expect(f.records.get(f.bookingId)!.status).toBe('CONFIRMED');
    expect((await webhook(f, raw, eventId)).status).toBe(200); expect(f.allocations.size).toBe(2); expect(f.evidence.size).toBe(1);
  });
  it('does not fulfill interrupted capture when fetched provider state is now refunded', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order);
    f.paymentState.failFinalize = true;
    expect((await verify(f, f.bookingId, value)).status).toBe(503);
    f.paymentState.failFinalize = false;
    f.providerPayments.set(value.id, { ...value, status: 'refunded', captured: true });
    const retried = await verify(f, f.bookingId, value);
    expect(retried.status).toBe(409); expect(retried.body.error.code).toBe('PAYMENT_RECONCILIATION_REQUIRED');
    expect([...f.payments.values()][0]!).toMatchObject({ status: 'SUCCESS', bookingFinalizedAt: null,
      reconciliation: { reason: 'FULFILLMENT_PENDING', compensationRequired: false } });
    expect(f.records.get(f.bookingId)!.status).toBe('PENDING'); expect(f.allocations.size).toBe(0); expect(f.holds.size).toBe(2);
  });
  it('rejects conflicting bytes reused with the same event identity', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order); const eventId = `evt_${randomUUID()}`;
    expect((await webhook(f, f.rawWebhook(value), eventId)).status).toBe(200);
    expect((await webhook(f, f.rawWebhook({ ...value, status: 'failed', captured: false }, 'payment.failed'), eventId)).status).toBe(409);
    expect([...f.payments.values()][0]!.status).toBe('SUCCESS'); expect(f.allocations.size).toBe(2);
  });
  it('ignores signed unsupported events without money or ticket writes', async () => {
    const f = await fixtureOrder(); expect((await webhook(f, Buffer.from('{"event":"subscription.charged","payload":{}}'))).status).toBe(200);
    expect(f.evidence.size).toBe(0); expect(f.allocations.size).toBe(0);
  });
  it('keeps provider outage errors safe without changing financial outcome', async () => {
    const f = await fixtureOrder(); const value = f.payment(f.order); f.paymentState.providerDown = true;
    const response = await verify(f, f.bookingId, value); expect(response.status).toBe(503);
    expect([...f.payments.values()][0]!.status).toBe('PENDING'); expect(f.allocations.size).toBe(0);
    expect(Object.keys(response.body.error).sort()).toEqual(['code', 'message', 'requestId']);
  });
});
