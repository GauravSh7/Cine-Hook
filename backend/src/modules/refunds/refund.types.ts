import type { Refund, RefundAttempt } from '../../generated/prisma/client.js';
import type { BookingConfirmationScope, BookingRecord } from '../booking/booking.types.js';
import type { EventBookingRecord } from '../event-booking/event-booking.types.js';
import type { PaymentEvent, PaymentRecord } from '../payments/payment.types.js';
import type { ProviderRefund } from '../payments/payment-provider.js';
import type { RefundService } from './refund.service.js';

export type RefundRecord = Refund & { attempts: RefundAttempt[] };
export type RefundView = { booking: BookingRecord | EventBookingRecord; payment: PaymentRecord; refunds: RefundRecord[] };
export type RefundBinding = { refund: RefundRecord; attempt: RefundAttempt };
export interface RefundStore {
  cancelCheckout?(userId: string, bookingId: string, work: (scope: BookingConfirmationScope) => Promise<unknown>): Promise<{booking:{id:string;status:string};paymentId:string|null}>;
  cancel(userId: string, bookingId: string, work: (scope: BookingConfirmationScope) => Promise<unknown>): Promise<string>;
  prepare(paymentId: string): Promise<void>;
  owned(userId: string, bookingId: string): Promise<RefundView | null>;
  pending(paymentId: string): Promise<RefundRecord[]>;
  attempt(refundId: string): Promise<RefundAttempt | null>;
  retryAttempt(refundId: string, failedProviderId: string): Promise<RefundAttempt | null>;
  record(refundId: string, attemptId: string, evidence: ProviderRefund, event?: PaymentEvent): Promise<void>;
  noteFailure(attemptId: string, code: string): Promise<void>;
  binding(refund: ProviderRefund): Promise<RefundBinding | null>;
  ignoreEvent(event: PaymentEvent): Promise<void>;
  candidates(limit: number): Promise<string[]>;
}
export interface RefundCoordinator {
  cancelCheckout?(userId:string,bookingId:string):Promise<unknown>;
  reconcile(paymentId: string): Promise<void>;
  webhook(refund: ProviderRefund, event: PaymentEvent): Promise<void>;
}
export interface RefundServices { refunds: RefundService }
