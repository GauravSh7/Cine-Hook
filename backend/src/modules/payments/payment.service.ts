import { AppError } from '../../errors/app-error.js';
import type { FinancialBookings } from '../booking/booking-gateway.js';
import type { PaymentProvider, ProviderOrder, ProviderPayment } from './payment-provider.js';
import type { PaymentEvent, PaymentRecord, PaymentStore, PaymentVerification } from './payment.types.js';
import type { RefundCoordinator } from '../refunds/refund.types.js';

function publicPayment(payment: PaymentRecord) {
  const amountPaise = Number(payment.amountPaise);
  if (!Number.isSafeInteger(amountPaise)) throw new AppError(500, 'INTERNAL_ERROR', 'Unable to read payment.');
  return { id: payment.id, bookingId: payment.bookingId, amountPaise, currency: payment.currency, status: payment.status,
    providerOrderId: payment.providerOrderId, providerPaymentId: payment.providerPaymentId,
    capturedAt: payment.capturedAt, bookingFinalizedAt: payment.bookingFinalizedAt, failureCode: payment.failureCode,
    reconciliation: payment.reconciliation ? { reason: payment.reconciliation.reason, compensationRequired: payment.reconciliation.compensationRequired,
      resolvedAt: payment.reconciliation.resolvedAt } : null };
}
const mismatch = () => new AppError(400, 'PAYMENT_MISMATCH', 'Provider evidence does not match this booking payment.');
const missing = () => new AppError(404, 'NOT_FOUND', 'Payment not found.');

export class PaymentService {
  constructor(private readonly payments: PaymentStore, private readonly bookings: FinancialBookings, private readonly provider: PaymentProvider,
    private readonly refunds?: RefundCoordinator, private readonly newOrdersAllowed = true) {}

  private available() {
    if (!this.provider.keyId) throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Payments are not configured.');
  }

  private matchOrder(payment: PaymentRecord, order: ProviderOrder) {
    if (order.receipt !== payment.receipt || BigInt(order.amountPaise) !== payment.amountPaise || order.currency !== payment.currency
      || (payment.providerOrderId && payment.providerOrderId !== order.id)) throw mismatch();
  }

  private matchPayment(payment: PaymentRecord, evidence: ProviderPayment) {
    if (evidence.orderId !== payment.providerOrderId || BigInt(evidence.amountPaise) !== payment.amountPaise || evidence.currency !== payment.currency) throw mismatch();
  }

  async order(userId: string, bookingId: string) {
    if (!this.newOrdersAllowed) throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'New payments are disabled for the staging catalogue.');
    this.available();
    const booking = await this.bookings.payable(userId, bookingId);
    let payment = await this.payments.reserve(userId.toLowerCase(), bookingId.toLowerCase());
    let order: ProviderOrder;
    if (payment.providerOrderId) {
      order = { id: payment.providerOrderId, amountPaise: Number(payment.amountPaise), currency: payment.currency,
        receipt: payment.receipt, status: payment.status === 'SUCCESS' ? 'paid' : 'created' };
    } else {
      // Receipt was committed before HTTP. A lost acknowledgement is recovered
      // by exact receipt; never create a different order or silently retry POST.
      order = await this.provider.findOrder(payment.receipt) ?? await this.provider.createOrder({ receipt: payment.receipt,
        amountPaise: Number(payment.amountPaise), currency: payment.currency });
      this.matchOrder(payment, order);
      payment = await this.payments.attachOrder(payment.id, order);
    }
    // HTTP may have consumed the hold. Keep the provider association for recovery,
    // but do not return an expired booking as a fresh checkout opportunity.
    await this.bookings.payable(userId, bookingId);
    return { payment: publicPayment(payment), order: { id: order.id, amountPaise: order.amountPaise, currency: order.currency,
      receipt: order.receipt, keyId: this.provider.keyId }, expiresAt: booking.expiresAt };
  }

  async verify(userId: string, input: PaymentVerification) {
    this.available();
    const payment = await this.payments.findByBooking(input.bookingId.toLowerCase());
    // Ownership is a PostgreSQL read, never a Redis-dependent booking observation:
    // a capture must still be durably recorded during a Redis outage.
    if (!payment || payment.booking.userId !== userId.toLowerCase()) throw missing();
    if (!payment.providerOrderId || payment.providerOrderId !== input.razorpay_order_id) throw mismatch();
    if (!this.provider.verifyCheckoutSignature(payment.providerOrderId, input.razorpay_payment_id, input.razorpay_signature)) {
      throw new AppError(400, 'INVALID_PAYMENT_SIGNATURE', 'Invalid payment signature.');
    }
    const evidence = await this.provider.fetchPayment(input.razorpay_payment_id);
    if (evidence.id !== input.razorpay_payment_id) throw mismatch();
    this.matchPayment(payment, evidence);
    // Refunded provider state must never enter fulfillment. Known return
    // progress can be refreshed from its own refund evidence; unsupported
    // external refunds still require reconciliation, not a guessed transition.
    if (evidence.status === 'refunded') {
      if (this.refunds && evidence.id === payment.providerPaymentId) {
        const current = await this.payments.findByBooking(payment.bookingId);
        if (current && ['REFUND_PENDING', 'REFUNDED'].includes(current.status)) {
          await this.refunds.reconcile(current.id);
          return { payment: publicPayment(await this.payments.findByBooking(current.bookingId) ?? current) };
        }
      }
      throw new AppError(409, 'PAYMENT_RECONCILIATION_REQUIRED', 'This provider payment state requires reconciliation.');
    }
    return { payment: publicPayment(await this.accept(payment, evidence)) };
  }

  private async accept(payment: PaymentRecord, evidence: ProviderPayment, event?: PaymentEvent) {
    this.matchPayment(payment, evidence);
    let recorded = await this.payments.recordEvidence(payment.id, evidence, event);
    if(recorded.status==='FAILED' && ['PENDING','CANCELLED'].includes(recorded.booking.status) && this.refunds?.cancelCheckout){
      await this.refunds.cancelCheckout(recorded.booking.userId,recorded.bookingId);
      recorded=await this.payments.findByBooking(recorded.bookingId)??recorded;
    }
    if (recorded.status === 'SUCCESS' && !recorded.bookingFinalizedAt) {
      try {
        recorded = await this.payments.finalize(recorded.id, async scope => {
          const booking = await this.bookings.confirm(recorded.bookingId, scope);
          return { confirmed: booking.status === 'CONFIRMED', reason: booking.failureCode ?? 'BOOKING_UNFULFILLED' };
        });
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 409
          || !['SEAT_BOOKED', 'DEPENDENCY_CONFLICT', 'PAYMENT_CONFLICT'].includes(error.code)) throw error;
        // CONCURRENT_CHANGE (deadlock/serialization abort) and unknown errors
        // remain retryable; a 409 alone is not permanent fulfillment evidence.
        // Allocation/commit-time expiry rejects the fulfillment transaction,
        // not the already committed capture. Finalize a compensation condition.
        recorded = await this.payments.finalize(recorded.id, async scope => {
          const booking = await this.bookings.failUnfulfilled(recorded.bookingId, 'FULFILLMENT_CONFLICT', scope);
          return { confirmed: booking.status === 'CONFIRMED', reason: booking.failureCode ?? 'FULFILLMENT_CONFLICT' };
        });
      }
    }
    if (event) await this.payments.markEventProcessed(event, recorded.id);
    if (this.refunds) {
      await this.refunds.reconcile(recorded.id);
      recorded = await this.payments.findByBooking(recorded.bookingId) ?? recorded;
    }
    return recorded;
  }

  async webhook(rawBody: Buffer, signature: string, eventId: string) {
    this.available();
    const webhook = this.provider.parseWebhook(rawBody, signature);
    if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(eventId)) throw new AppError(400, 'INVALID_WEBHOOK_EVENT', 'Webhook event identity is required.');
    const event: PaymentEvent = { id: eventId, digest: webhook.digest, type: webhook.eventType.slice(0, 60),
      providerPaymentId: webhook.refund?.paymentId ?? webhook.payment?.id ?? null, providerRefundId: webhook.refund?.id ?? null };
    if (webhook.refund) {
      if (!this.refunds) throw new AppError(503, 'REFUNDS_UNAVAILABLE', 'Refund processing is unavailable.');
      await this.refunds.webhook(webhook.refund, event); return { received: true };
    }
    if (!webhook.payment) { await this.payments.markEventProcessed(event, null); return { received: true }; }
    let payment = await this.payments.findByOrder(webhook.payment.orderId);
    if (!payment) {
      // Covers capture delivered after provider creation but before local attach.
      // Trust the provider's server-side order/receipt, never arbitrary notes.
      const order = await this.provider.fetchOrder(webhook.payment.orderId);
      payment = await this.payments.findByReceipt(order.receipt);
      if (!payment) { await this.payments.markEventProcessed(event, null); return { received: true }; }
      this.matchOrder(payment, order);
      payment = await this.payments.attachOrder(payment.id, order);
    }
    if (webhook.order) this.matchOrder(payment, webhook.order);
    await this.accept(payment, webhook.payment, event);
    return { received: true };
  }
}
