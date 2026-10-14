import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import request from 'supertest';
import { refundFixture } from './helpers/refunds.js';
import { checkoutSignature, webhookSignature } from './helpers/payments.js';

async function paid() {
  const f = await refundFixture(); const book = await f.bookingService.create(f.userId, { showId: f.show.id, seatIds: f.seats.map(seat => seat.id) });
  const created = await f.paymentService.order(f.userId, book.id); const order = f.providerOrders.get(created.order.id)!; const capture = f.payment(order);
  await f.paymentService.verify(f.userId, { bookingId: book.id, razorpay_order_id: order.id, razorpay_payment_id: capture.id, razorpay_signature: checkoutSignature(order.id, capture.id) });
  return { ...f, bookingId: book.id, capture };
}
const cancel = (f: Awaited<ReturnType<typeof paid>>, body = {}, bearer = f.token) => request(f.app).post(`/api/bookings/${f.bookingId}/cancel`).set('Authorization', `Bearer ${bearer}`).send(body);
it('owner cancellation returns full trusted refund and preserves historical seats', async () => {
  const f = await paid(); const history = f.records.get(f.bookingId)!.seats;
  const result = await cancel(f); expect(result.status).toBe(200); expect(result.body.data.booking.status).toBe('CANCELLED');
  expect(result.body.data.payment.status).toBe('REFUNDED'); expect(result.body.data.refunds[0]).toMatchObject({ amountPaise: 25000, status: 'REFUNDED' });
  expect(f.allocations.size).toBe(0); expect(f.records.get(f.bookingId)!.seats).toEqual(history);
});
it('does not depend on Redis for paid cancellation', async () => {
  const f = await paid(); f.state.redisDown = true; expect((await cancel(f)).status).toBe(200); expect(f.allocations.size).toBe(0);
});
it.each([{ amountPaise: 1 }, { refunded: true }, { status: 'REFUNDED' }, { userId: randomUUID() }])('rejects browser financial/state input %j', async body => {
  const f = await paid(); expect((await cancel(f, body)).status).toBe(400); expect(f.records.get(f.bookingId)!.status).toBe('CONFIRMED');
});
it('protects cancellation and hides foreign booking history', async () => {
  const f = await paid(); expect((await request(f.app).post(`/api/bookings/${f.bookingId}/cancel`).send({})).status).toBe(401);
  expect((await cancel(f, {}, f.otherToken)).status).toBe(404); expect((await request(f.app).get(`/api/bookings/${f.bookingId}/refunds`).set('Authorization', `Bearer ${f.otherToken}`)).status).toBe(404);
});
it('restricts backlog reconciliation to the current database ADMIN role', async () => {
  const f = await paid();
  expect((await request(f.app).post('/api/admin/refunds/reconcile').set('Authorization', `Bearer ${f.token}`).send({})).status).toBe(403);
  f.users.get(f.userId)!.role = 'ADMIN';
  expect((await request(f.app).post('/api/admin/refunds/reconcile').set('Authorization', `Bearer ${f.token}`).send({})).status).toBe(200);
});
it('keeps cancellation durable while refund initiation is unavailable then retries', async () => {
  const f = await paid(); f.refundState.down = true; const first = await cancel(f);
  expect(first.status).toBe(202); expect(first.body.data.payment.status).toBe('REFUND_PENDING'); expect(f.records.get(f.bookingId)!.status).toBe('CANCELLED'); expect(f.allocations.size).toBe(0);
  f.refundState.down = false;
  const retried = await request(f.app).post(`/api/bookings/${f.bookingId}/refund/retry`).set('Authorization', `Bearer ${f.token}`).send({});
  expect(retried.status).toBe(200); expect(retried.body.data.payment.status).toBe('REFUNDED'); expect(f.providerRefunds.size).toBe(1);
});
it('recovers lost refund acknowledgement with the same attempt identity', async () => {
  const f = await paid(); f.refundState.loseAck = true; expect((await cancel(f)).status).toBe(202);
  const initial = [...f.refunds.values()][0]!.attempts[0]!.id;
  expect((await cancel(f)).status).toBe(200); expect(f.providerRefunds.size).toBe(1); expect([...f.refunds.values()][0]!.attempts[0]!.id).toBe(initial);
});
it('concurrent cancellation and repeat requests do not create extra refund effects', async () => {
  const f = await paid(); const results = await Promise.all([cancel(f), cancel(f), cancel(f)]);
  expect(results.every(result => [200, 202].includes(result.status))).toBe(true); expect(f.providerRefunds.size).toBe(1); expect(f.refunds.size).toBe(1);
  f.state.now = new Date(f.show.startsAt); expect((await cancel(f)).status).toBe(200);
});
it('verification of a known refunded source returns persisted refund progress without confirmation', async () => {
  const f = await paid(); expect((await cancel(f)).status).toBe(200);
  f.providerPayments.set(f.capture.id, { ...f.capture, status: 'refunded', captured: true });
  const response = await request(f.app).post('/api/payments/verify').set('Authorization', `Bearer ${f.token}`).send({ bookingId: f.bookingId,
    razorpay_order_id: f.capture.orderId, razorpay_payment_id: f.capture.id, razorpay_signature: checkoutSignature(f.capture.orderId, f.capture.id) });
  expect(response.status).toBe(200); expect(response.body.data.payment.status).toBe('REFUNDED');
  expect(f.records.get(f.bookingId)!.status).toBe('CANCELLED'); expect(f.allocations.size).toBe(0); expect(f.providerRefunds.size).toBe(1);
});
it('retries a provider-confirmed failed refund using a new persisted attempt', async () => {
  const f = await paid(); f.refundState.result = 'failed'; expect((await cancel(f)).status).toBe(202);
  f.refundState.result = 'processed'; expect((await cancel(f)).status).toBe(200);
  expect([...f.refunds.values()][0]!.attempts).toHaveLength(2); expect(f.providerRefunds.size).toBe(2);
});
it('refund webhook before local acknowledgement completes the persisted attempt once', async () => {
  const f = await paid(); f.refundState.loseAck = true; expect((await cancel(f)).status).toBe(202);
  const refund = [...f.providerRefunds.values()][0]!; const raw = Buffer.from(JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: {
    id: refund.id, payment_id: refund.paymentId, amount: refund.amountPaise, currency: refund.currency, receipt: refund.receipt, status: refund.status } } } }));
  // The real RefundService is invoked through the same raw webhook handler.
  f.provider.parseWebhook = (bytes, signature) => { if (webhookSignature(bytes) !== signature) throw new Error('invalid signature'); return { eventType: 'refund.processed', refund, digest: 'a'.repeat(64) }; };
  for (let i = 0; i < 2; i++) expect((await request(f.app).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('X-Razorpay-Signature', webhookSignature(raw)).set('X-Razorpay-Event-Id', 'evt_refund_repeat').send(raw.toString())).status).toBe(200);
  expect([...f.payments.values()][0]!.status).toBe('REFUNDED'); expect(f.providerRefunds.size).toBe(1);
});
it('paid unfulfilled compensation refunds after show time without reviving seats', async () => {
  const f = await refundFixture(); const book = await f.bookingService.create(f.userId, { showId: f.show.id, seatIds: f.seats.map(seat => seat.id) });
  const created = await f.paymentService.order(f.userId, book.id); const capture = f.payment(f.providerOrders.get(created.order.id)!);
  await f.bookingService.releaseHold(f.userId, book.id); f.state.now = new Date(f.show.startsAt.getTime() + 1);
  const result = await f.paymentService.verify(f.userId, { bookingId: book.id, razorpay_order_id: capture.orderId, razorpay_payment_id: capture.id, razorpay_signature: checkoutSignature(capture.orderId, capture.id) });
  expect(result.payment.status).toBe('REFUNDED'); expect(f.records.get(book.id)!.status).toBe('CANCELLED'); expect(f.allocations.size).toBe(0);
  expect([...f.refunds.values()][0]!.amountPaise).toBe(25000n); expect(f.state.acquires).toBe(1);
});
