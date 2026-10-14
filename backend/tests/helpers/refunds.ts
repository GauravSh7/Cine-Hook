import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { AppError } from '../../src/errors/app-error.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { HealthService } from '../../src/modules/health/health.service.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';
import { RefundService } from '../../src/modules/refunds/refund.service.js';
import type { RefundStore, RefundRecord } from '../../src/modules/refunds/refund.types.js';
import type { ProviderRefund } from '../../src/modules/payments/payment-provider.js';
import { paymentFixture } from './payments.js';

// Test-only persistence/provider I/O. Booking/Payment/Refund policy and HTTP are real.
export async function refundFixture() {
  const f = await paymentFixture(); const refunds = new Map<string, RefundRecord>();
  const providerRefunds = new Map<string, ProviderRefund>(); const keys = new Map<string, string>();
  const state = { down: false, loseAck: false, result: 'processed' as ProviderRefund['status'] };
  const now = () => new Date(f.state.now);
  const payment = (id: string) => f.payments.get(id)!;
  const refresh = (id: string) => {
    const value = payment(id), booking = f.records.get(value.bookingId)!;
    const captures = [...f.evidence.values()].filter(item => item.paymentId === id && item.captured);
    const all = captures.every(item => [...refunds.values()].some(refund => refund.providerPaymentId === item.providerPaymentId && refund.status === 'REFUNDED'));
    if (booking.status === 'CANCELLED' || booking.status === 'FAILED') value.status = all ? 'REFUNDED' : 'REFUND_PENDING';
    const owed = [...refunds.values()].some(refund => refund.paymentId === id && refund.status !== 'REFUNDED');
    if (value.reconciliation && !owed) value.reconciliation.resolvedAt ??= now();
  };
  const tails = new Map<string, Promise<unknown>>();
  const serial = <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const result = (tails.get(id) ?? Promise.resolve()).catch(() => {}).then(work); tails.set(id, result); return result;
  };
  const prepare = async (id: string) => {
    const value = payment(id), book = f.records.get(value.bookingId)!;
    const all = book.status === 'CANCELLED' || book.status === 'FAILED';
    if (!all && book.status !== 'CONFIRMED') return;
    for (const evidence of f.evidence.values()) {
      if (evidence.paymentId !== id || !evidence.captured || (!all && evidence.providerPaymentId === value.providerPaymentId)) continue;
      if ([...refunds.values()].some(item => item.providerPaymentId === evidence.providerPaymentId)) continue;
      const refund: RefundRecord = { id: randomUUID(), paymentId: id, providerPaymentId: evidence.providerPaymentId,
        amountPaise: evidence.amountPaise, currency: evidence.currency, reason: book.status === 'CANCELLED' ? 'BOOKING_CANCELLED' : all ? 'BOOKING_UNFULFILLED' : 'DUPLICATE_CAPTURE',
        status: 'PENDING', createdAt: now(), updatedAt: now(), attempts: [] };
      refunds.set(refund.id, refund);
    }
    if ([...refunds.values()].some(item => item.paymentId === id)) {
      value.reconciliation ??= { id: randomUUID(), paymentId: id, reason: all ? 'BOOKING_UNFULFILLED' : 'DUPLICATE_CAPTURE',
        compensationRequired: true, resolvedAt: null, createdAt: now(), updatedAt: now() };
      refresh(id);
    }
  };
  const nextAttempt = (refund: RefundRecord) => {
    const id = randomUUID(); const attempt = { id, refundId: refund.id, sequence: refund.attempts.length + 1, receipt: id,
      providerRefundId: null, status: 'REQUESTED' as const, lastErrorCode: null, processedAt: null, createdAt: now(), updatedAt: now() };
    refund.attempts.unshift(attempt); return attempt;
  };
  const store: RefundStore = {
    cancel: async (owner, bookingId, work) => serial(bookingId, async () => {
      const value = [...f.payments.values()].find(item => item.bookingId === bookingId);
      if (!value || f.records.get(bookingId)?.userId !== owner) throw new AppError(404, 'NOT_FOUND', 'Booking not found.');
      if (!value.capturedAt) throw new AppError(409, 'PAYMENT_STATE', 'Payment is not captured.');
      await work({ store: f.store, afterCommit: () => {} }); await prepare(value.id); return value.id;
    }),
    prepare: async id => serial(id, () => prepare(id)),
    owned: async (owner, bookingId) => {
      const booking = f.records.get(bookingId); const value = [...f.payments.values()].find(item => item.bookingId === bookingId);
      if (!booking || !value || booking.userId !== owner) return null;
      return { booking, payment: value, refunds: [...refunds.values()].filter(item => item.paymentId === value.id) };
    },
    pending: async id => [...refunds.values()].filter(item => item.paymentId === id && item.status === 'PENDING'),
    attempt: async id => serial(id, async () => { const value = refunds.get(id)!; return value.status === 'REFUNDED' ? null : value.attempts[0] ?? nextAttempt(value); }),
    retryAttempt: async (id, failedProviderId) => serial(id, async () => {
      const value = refunds.get(id)!; if (value.status === 'REFUNDED') return null;
      const latest = value.attempts[0]!;
      return latest.status === 'FAILED' && latest.providerRefundId === failedProviderId ? nextAttempt(value) : latest;
    }),
    record: async (id, attemptId, evidence, event) => serial(id, async () => {
      const refund = refunds.get(id)!, attempt = refund.attempts.find(item => item.id === attemptId)!;
      if (evidence.paymentId !== refund.providerPaymentId || BigInt(evidence.amountPaise) !== refund.amountPaise || evidence.currency !== refund.currency
        || evidence.receipt !== attempt.receipt || (attempt.providerRefundId && attempt.providerRefundId !== evidence.id)) throw new AppError(400, 'REFUND_MISMATCH', 'Refund evidence does not match.');
      if (event) {
        const existing = f.events.get(event.id);
        if (existing && (existing.digest !== event.digest || existing.paymentId !== refund.paymentId || existing.providerRefundId !== evidence.id)) throw new AppError(409, 'EVENT_CONFLICT', 'Event identity conflicts.');
        if (!existing) f.events.set(event.id, { providerEventId: event.id, digest: event.digest, eventType: event.type,
          paymentId: refund.paymentId, providerPaymentId: refund.providerPaymentId, providerRefundId: evidence.id, processedAt: now(), createdAt: now() });
      }
      attempt.providerRefundId ??= evidence.id;
      if (attempt.status !== 'PROCESSED') attempt.status = evidence.status === 'processed' ? 'PROCESSED' : evidence.status === 'failed' ? 'FAILED' : attempt.status === 'FAILED' ? 'FAILED' : 'PENDING';
      if (attempt.status === 'PROCESSED') { attempt.processedAt ??= now(); refund.status = 'REFUNDED'; }
      refresh(refund.paymentId);
    }),
    noteFailure: async (id, code) => { for (const value of refunds.values()) { const attempt = value.attempts.find(item => item.id === id); if (attempt) attempt.lastErrorCode = code; } },
    binding: async evidence => {
      for (const refund of refunds.values()) for (const attempt of refund.attempts) {
        if (attempt.providerRefundId === evidence.id || (evidence.receipt && attempt.receipt === evidence.receipt)) return { refund, attempt };
      }
      return null;
    },
    ignoreEvent: async () => {}, candidates: async limit => [...new Set([...refunds.values()].filter(item => item.status === 'PENDING').map(item => item.paymentId))].slice(0, limit),
  };
  f.provider.createRefund = async input => {
    if (state.down) throw new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Provider unavailable.');
    const known = keys.get(input.idempotencyKey); if (known) return providerRefunds.get(known)!;
    const result: ProviderRefund = { id: `rfnd_${randomUUID().replaceAll('-', '')}`, paymentId: input.paymentId, amountPaise: input.amountPaise,
      currency: input.currency, receipt: input.receipt, status: state.result };
    providerRefunds.set(result.id, result); keys.set(input.idempotencyKey, result.id);
    if (state.loseAck) { state.loseAck = false; throw new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Lost acknowledgement.'); }
    return result;
  };
  f.provider.fetchRefund = async id => { if (state.down) throw new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Provider unavailable.'); return providerRefunds.get(id)!; };
  const refundService = new RefundService(store, f.bookingService, f.provider);
  const paymentService = new PaymentService(f.paymentStore, f.bookingService, f.provider, refundService);
  const auth = new AuthService({ create: async () => { throw new Error('unused'); }, findByEmail: async () => null, findById: async id => f.users.get(id) ?? null }, f.tokens);
  const app = createApp({ frontendOrigin: 'http://localhost:5173', catalog: f.catalog.services, shows: f.shows.services,
    booking: { bookings: f.bookingService }, payments: { payments: paymentService, refunds: refundService }, auth: { service: auth, tokens: f.tokens },
    healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }) });
  return { ...f, app, refundService, paymentService, refundStore: store, refunds, providerRefunds, refundState: state };
}
