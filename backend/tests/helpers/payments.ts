import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { AppError } from '../../src/errors/app-error.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { HealthService } from '../../src/modules/health/health.service.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';
import type { PaymentProvider, ProviderOrder, ProviderPayment } from '../../src/modules/payments/payment-provider.js';
import type { PaymentEvent, PaymentRecord, PaymentStore } from '../../src/modules/payments/payment.types.js';
import type { PaymentEvidence, PaymentWebhookEvent } from '../../src/generated/prisma/client.js';
import { bookingFixture } from './booking.js';

export const paymentKeySecret = 'payment-provider-test-only-secret';
export const paymentWebhookSecret = 'payment-webhook-test-only-secret';
export const checkoutSignature = (orderId: string, paymentId: string) => createHmac('sha256', paymentKeySecret).update(`${orderId}|${paymentId}`).digest('hex');
export const webhookSignature = (body: Buffer) => createHmac('sha256', paymentWebhookSecret).update(body).digest('hex');

// These replace only persistence/provider I/O. The production PaymentService,
// BookingService, HTTP middleware and controllers enforce the tested policies.
export async function paymentFixture() {
  const booking = await bookingFixture();
  const payments = new Map<string, PaymentRecord>();
  const evidence = new Map<string, PaymentEvidence>();
  const events = new Map<string, PaymentWebhookEvent>();
  const providerOrders = new Map<string, ProviderOrder>();
  const providerPayments = new Map<string, ProviderPayment>();
  const state = { providerDown: false, loseOrderAck: false, failReserve: false, failFinalize: false,
    loseFinalizeAck: false, providerCreates: 0, providerFetches: 0, providerPaymentSequence: 0 };
  const now = () => new Date(booking.state.now);
  const unavailable = () => new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Payment provider is temporarily unavailable.');
  const sameHmac = (want: string, actual: string) => /^[0-9a-f]{64}$/i.test(actual)
    && timingSafeEqual(Buffer.from(want, 'hex'), Buffer.from(actual, 'hex'));
  const provider: PaymentProvider = {
    keyId: 'rzp_test_local_payment_fixture',
    createOrder: async input => {
      if (state.providerDown) throw unavailable();
      state.providerCreates++;
      const order: ProviderOrder = { id: `order_${String(state.providerCreates).padStart(8, '0')}`, ...input, status: 'created' };
      providerOrders.set(order.id, order);
      if (state.loseOrderAck) { state.loseOrderAck = false; throw unavailable(); }
      return order;
    },
    findOrder: async receipt => {
      if (state.providerDown) throw unavailable();
      return [...providerOrders.values()].find(order => order.receipt === receipt) ?? null;
    },
    fetchOrder: async id => {
      if (state.providerDown) throw unavailable();
      state.providerFetches++;
      const order = providerOrders.get(id); if (!order) throw unavailable(); return order;
    },
    fetchPayment: async id => {
      if (state.providerDown) throw unavailable();
      state.providerFetches++;
      const value = providerPayments.get(id); if (!value) throw unavailable(); return value;
    },
    verifyCheckoutSignature: (orderId, paymentId, signature) => sameHmac(checkoutSignature(orderId, paymentId), signature),
    parseWebhook: (raw, signature) => {
      if (!Buffer.isBuffer(raw) || !sameHmac(webhookSignature(raw), signature)) throw new AppError(400, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
      const body = JSON.parse(raw.toString('utf8')) as { event: string; payload?: { payment?: { entity: Record<string, unknown> }; order?: { entity: Record<string, unknown> } } };
      const payment = body.payload?.payment?.entity;
      const order = body.payload?.order?.entity;
      return { eventType: body.event, digest: createHash('sha256').update(raw).digest('hex'),
        ...(payment ? { payment: { id: String(payment.id), orderId: String(payment.order_id), amountPaise: Number(payment.amount),
          currency: String(payment.currency), status: payment.status as ProviderPayment['status'], captured: payment.captured === true } } : {}),
        ...(order ? { order: { id: String(order.id), receipt: String(order.receipt), amountPaise: Number(order.amount),
          currency: String(order.currency), status: order.status as ProviderOrder['status'] } } : {}) };
    },
  };
  const requirePayment = (id: string) => { const value = payments.get(id); if (!value) throw new AppError(404, 'NOT_FOUND', 'Payment not found.'); return value; };
  const ensureEvent = (event: PaymentEvent, paymentId: string | null) => {
    const previous = events.get(event.id);
    if (previous && (previous.digest !== event.digest || previous.eventType !== event.type || previous.providerPaymentId !== event.providerPaymentId || previous.paymentId !== paymentId)) {
      throw new AppError(409, 'EVENT_CONFLICT', 'Webhook identity conflicts with stored evidence.');
    }
    if (!previous) events.set(event.id, { providerEventId: event.id, digest: event.digest, eventType: event.type,
      paymentId, providerPaymentId: event.providerPaymentId, processedAt: null, createdAt: now() });
  };
  // Model repository-owned transaction serialization; this is not a simulation
  // of Redis Lua or PostgreSQL constraints, which run in live integration tests.
  const tails = new Map<string, Promise<unknown>>();
  const serial = <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const result = (tails.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    tails.set(id, result); return result;
  };
  const store: PaymentStore = {
    reserve: async (owner, bookingId) => serial(bookingId, async () => {
      if (state.failReserve) throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Payment is temporarily unavailable.');
      const record = booking.records.get(bookingId);
      if (!record || record.userId !== owner) throw new AppError(404, 'NOT_FOUND', 'Booking not found.');
      const existing = [...payments.values()].find(value => value.bookingId === bookingId); if (existing) return existing;
      const value: PaymentRecord = { id: randomUUID(), bookingId, receipt: bookingId, amountPaise: record.totalPaise, currency: 'INR',
        providerOrderId: null, providerPaymentId: null, status: 'PENDING', capturedAt: null, bookingFinalizedAt: null,
        failureCode: null, createdAt: now(), updatedAt: now(), reconciliation: null,
        booking: { userId: record.userId, status: record.status, expiresAt: record.expiresAt } };
      payments.set(value.id, value); return value;
    }),
    attachOrder: async (id, order) => {
      const value = requirePayment(id);
      const next = { ...value, providerOrderId: order.id, updatedAt: now() }; payments.set(id, next); return next;
    },
    findByBooking: async id => [...payments.values()].find(value => value.bookingId === id) ?? null,
    findByOrder: async id => [...payments.values()].find(value => value.providerOrderId === id) ?? null,
    findByReceipt: async receipt => [...payments.values()].find(value => value.receipt === receipt) ?? null,
    recordEvidence: async (id, input, event) => serial(id, async () => {
      const value = requirePayment(id); if (event) ensureEvent(event, id);
      const previous = evidence.get(input.id);
      if (previous && previous.paymentId !== id) throw new AppError(409, 'PAYMENT_CONFLICT', 'Payment identity is already bound.');
      const captured = Boolean(previous?.captured) || (input.status === 'captured' && input.captured);
      evidence.set(input.id, { providerPaymentId: input.id, paymentId: id, amountPaise: BigInt(input.amountPaise), currency: input.currency,
        captured, failureSeen: Boolean(previous?.failureSeen) || input.status === 'failed', createdAt: previous?.createdAt ?? now(), updatedAt: now() });
      const returning = value.status === 'REFUND_PENDING' || value.status === 'REFUNDED';
      const success = value.status === 'SUCCESS' || returning || captured;
      const next: PaymentRecord = { ...value, status: returning
        ? value.status === 'REFUNDED' && captured && !previous?.captured && value.providerPaymentId !== input.id ? 'REFUND_PENDING' : value.status
        : success ? 'SUCCESS' : input.status === 'failed' ? 'FAILED' : value.status,
        providerPaymentId: captured ? value.providerPaymentId ?? input.id : value.providerPaymentId,
        capturedAt: captured ? value.capturedAt ?? now() : value.capturedAt, updatedAt: now(),
        reconciliation: captured && !value.bookingFinalizedAt ? value.reconciliation ?? { id: randomUUID(), paymentId: id,
          reason: 'FULFILLMENT_PENDING', compensationRequired: false, createdAt: now(), updatedAt: now() } : value.reconciliation };
      payments.set(id, next); return next;
    }),
    finalize: async (id, work) => serial(id, async () => {
      const value = requirePayment(id); if (value.bookingFinalizedAt) return value;
      if (state.failFinalize) throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Payment finalization is temporarily unavailable.');
      const callbacks: Array<() => Promise<void>> = [];
      const oldRecord = booking.records.get(value.bookingId);
      const oldAllocations = new Map(booking.allocations);
      let result;
      try { result = await work({ store: booking.store, afterCommit: callback => { callbacks.push(callback); } }); }
      catch (error) {
        if (oldRecord) booking.records.set(oldRecord.id, oldRecord);
        booking.allocations.clear(); for (const [key, allocated] of oldAllocations) booking.allocations.set(key, allocated);
        throw error;
      }
      const next: PaymentRecord = { ...requirePayment(id), bookingFinalizedAt: now(), updatedAt: now(),
        reconciliation: result.confirmed ? null : { id: value.reconciliation?.id ?? randomUUID(), paymentId: id,
          reason: result.reason ?? 'BOOKING_UNFULFILLED', compensationRequired: true, createdAt: value.reconciliation?.createdAt ?? now(), updatedAt: now() } };
      payments.set(id, next);
      for (const callback of callbacks) await callback();
      if (state.loseFinalizeAck) { state.loseFinalizeAck = false; throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Injected lost finalization acknowledgement.'); }
      return next;
    }),
    markEventProcessed: async (event, paymentId) => {
      ensureEvent(event, paymentId); const value = events.get(event.id)!; events.set(event.id, { ...value, processedAt: now() });
    },
  };
  const service = new PaymentService(store, booking.service, provider);
  const auth = new AuthService({ create: async () => { throw new Error('unused'); }, findByEmail: async () => null,
    findById: async id => booking.users.get(id) ?? null }, booking.tokens);
  const app = createApp({ frontendOrigin: 'http://localhost:5173', catalog: booking.catalog.services, shows: booking.shows.services,
    booking: { bookings: booking.service }, payments: { payments: service }, auth: { service: auth, tokens: booking.tokens },
    healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }) });
  const payment = (order: ProviderOrder, overrides: Partial<ProviderPayment> = {}) => {
    const value: ProviderPayment = { id: `pay_${String(++state.providerPaymentSequence).padStart(8, '0')}`, orderId: order.id,
      amountPaise: order.amountPaise, currency: order.currency, status: 'captured', captured: true, ...overrides };
    providerPayments.set(value.id, value);
    if (value.captured) providerOrders.set(order.id, { ...order, status: 'paid' });
    return value;
  };
  const rawWebhook = (value: ProviderPayment, event = 'payment.captured', order?: ProviderOrder) => Buffer.from(JSON.stringify({ event,
    payload: { payment: { entity: { id: value.id, order_id: value.orderId, amount: value.amountPaise, currency: value.currency,
      status: value.status, captured: value.captured } }, ...(order ? { order: { entity: { id: order.id, receipt: order.receipt,
        amount: order.amountPaise, currency: order.currency, status: order.status } } } : {}) } }, null, 2));
  return { ...booking, app, bookingService: booking.service, service, paymentStore: store, payments, evidence, events,
    provider, providerOrders, providerPayments, paymentState: state, payment, rawWebhook };
}
