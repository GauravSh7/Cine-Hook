import type { Payment, PaymentEvidence, PaymentReconciliation } from '../../generated/prisma/client.js';
import type { BookingConfirmationScope } from '../booking/booking.types.js';
import type { ProviderOrder, ProviderPayment } from './payment-provider.js';
import type { PaymentService } from './payment.service.js';
import type { RefundService } from '../refunds/refund.service.js';

export type PaymentRecord = Payment & { reconciliation: PaymentReconciliation | null;
  booking: { userId: string; status: string; expiresAt: Date } };
export type PaymentVerification = { bookingId: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
export type PaymentEvent = { id: string; digest: string; type: string; providerPaymentId: string | null; providerRefundId?: string | null };
export type Fulfillment = { confirmed: boolean; reason: string | null };
export interface PaymentStore {
  reserve(userId: string, bookingId: string): Promise<PaymentRecord>;
  attachOrder(paymentId: string, order: ProviderOrder): Promise<PaymentRecord>;
  findByBooking(bookingId: string): Promise<PaymentRecord | null>;
  findByOrder(orderId: string): Promise<PaymentRecord | null>;
  findByReceipt(receipt: string): Promise<PaymentRecord | null>;
  recordEvidence(paymentId: string, evidence: ProviderPayment, event?: PaymentEvent): Promise<PaymentRecord>;
  finalize(paymentId: string, work: (scope: BookingConfirmationScope) => Promise<Fulfillment>): Promise<PaymentRecord>;
  markEventProcessed(event: PaymentEvent, paymentId: string | null): Promise<void>;
}
export type FinancialEvidence = PaymentEvidence;
export interface PaymentServices { payments: PaymentService; refunds?: RefundService }
