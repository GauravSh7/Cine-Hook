import { AppError } from '../../errors/app-error.js';
import type { FinancialBookings } from '../booking/booking-gateway.js';
import type { PaymentProvider, ProviderRefund } from '../payments/payment-provider.js';
import type { PaymentEvent } from '../payments/payment.types.js';
import type { RefundAttempt } from '../../generated/prisma/client.js';
import type { RefundCoordinator, RefundRecord, RefundStore, RefundView } from './refund.types.js';

const missing = () => new AppError(404, 'NOT_FOUND', 'Booking payment not found.');
const mismatch = () => new AppError(400, 'REFUND_MISMATCH', 'Provider evidence does not match this refund.');
function publicView(view: RefundView) {
  return { booking: { id: view.booking.id, status: view.booking.status, totalPaise: Number(view.booking.totalPaise) },
    payment: { id: view.payment.id, status: view.payment.status, amountPaise: Number(view.payment.amountPaise), currency: view.payment.currency,
      reconciliation: view.payment.reconciliation ? { reason: view.payment.reconciliation.reason,
        compensationRequired: view.payment.reconciliation.compensationRequired, resolvedAt: view.payment.reconciliation.resolvedAt } : null },
    refunds: view.refunds.map(value => ({ id: value.id, providerPaymentId: value.providerPaymentId, amountPaise: Number(value.amountPaise),
      currency: value.currency, reason: value.reason, status: value.status, attempts: value.attempts.map(attempt => ({ id: attempt.id,
        sequence: attempt.sequence, providerRefundId: attempt.providerRefundId, status: attempt.status, lastErrorCode: attempt.lastErrorCode,
        processedAt: attempt.processedAt })) })) };
}

export class RefundService implements RefundCoordinator {
  constructor(private readonly store: RefundStore, private readonly bookings: FinancialBookings, private readonly provider: PaymentProvider) {}

  async get(userId: string, bookingId: string) {
    const view = await this.store.owned(userId.toLowerCase(), bookingId.toLowerCase());
    if (!view) throw missing(); return publicView(view);
  }
  async cancel(userId: string, bookingId: string) {
    const owner = userId.toLowerCase(), id = bookingId.toLowerCase();
    const paymentId = await this.store.cancel(owner, id, scope => this.bookings.cancel(owner, id, scope));
    // The cancellation/obligation commit is complete before any provider HTTP.
    await this.reconcile(paymentId); return this.get(owner, id);
  }
  async cancelCheckout(userId:string,bookingId:string) {
    if(!this.store.cancelCheckout)throw new AppError(503,'CANCELLATION_UNAVAILABLE','Checkout cancellation is unavailable.');
    const owner=userId.toLowerCase(),id=bookingId.toLowerCase();
    const result=await this.store.cancelCheckout(owner,id,scope=>this.bookings.cancel(owner,id,scope));
    if(result.paymentId)await this.reconcile(result.paymentId);
    return {booking:result.booking};
  }
  async retry(userId: string, bookingId: string) {
    const view = await this.store.owned(userId.toLowerCase(), bookingId.toLowerCase());
    if (!view) throw missing(); await this.reconcile(view.payment.id); return this.get(userId, bookingId);
  }
  async reconcileBatch() {
    const ids = await this.store.candidates(20);
    for (const id of ids) await this.reconcile(id);
    return { examined: ids.length };
  }
  private match(refund: RefundRecord, attempt: RefundAttempt, evidence: ProviderRefund) {
    if (evidence.paymentId !== refund.providerPaymentId || BigInt(evidence.amountPaise) !== refund.amountPaise || evidence.currency !== refund.currency
      || evidence.receipt !== attempt.receipt || (attempt.providerRefundId && attempt.providerRefundId !== evidence.id)) throw mismatch();
  }
  async reconcile(paymentId: string) {
    await this.store.prepare(paymentId);
    for (const refund of await this.store.pending(paymentId)) {
      let attempt = await this.store.attempt(refund.id); if (!attempt) continue;
      const initialAttemptId = attempt.id;
      try {
        if (!this.provider.keyId) throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Payments are not configured.');
        if (attempt.providerRefundId) {
          const current = await this.provider.fetchRefund(attempt.providerRefundId); this.match(refund, attempt, current);
          await this.store.record(refund.id, attempt.id, current);
          if (attempt.status !== 'FAILED' || current.status !== 'failed') continue;
          // A new key is allowed only after fetching authoritative failure for
          // the previous attempt. The repository serializes concurrent retry.
          attempt = await this.store.retryAttempt(refund.id, current.id); if (!attempt) continue;
          if (attempt.providerRefundId) continue;
        }
        const evidence = await this.provider.createRefund({ paymentId: refund.providerPaymentId,
          amountPaise: Number(refund.amountPaise), currency: refund.currency, receipt: attempt.receipt, idempotencyKey: attempt.id });
        this.match(refund, attempt, evidence); await this.store.record(refund.id, attempt.id, evidence);
      } catch (error) {
        // Uncertain initiation/delivery keeps the same durable attempt/key.
        // Never restore a cancelled booking or discard captured history.
        const code = error instanceof AppError ? error.code : 'REFUND_DEPENDENCY_UNAVAILABLE';
        await this.store.noteFailure(attempt?.id ?? initialAttemptId, code);
      }
    }
  }
  async webhook(evidence: ProviderRefund, event: PaymentEvent) {
    const binding = await this.store.binding(evidence);
    if (!binding) { await this.store.ignoreEvent(event); return; }
    this.match(binding.refund, binding.attempt, evidence);
    await this.store.record(binding.refund.id, binding.attempt.id, evidence, event);
  }
}
