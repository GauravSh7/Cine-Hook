import type { PrismaClient } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import type { FinancialBookings } from '../booking/booking-gateway.js';
import type { PaymentProvider } from './payment-provider.js';
import { RazorpayProvider, type RazorpayOptions } from './razorpay.provider.js';
import { PaymentRepository } from './payment.repository.js';
import { PaymentService } from './payment.service.js';
import { RefundRepository } from '../refunds/refund.repository.js';
import { RefundService } from '../refunds/refund.service.js';
import {PricingRepository} from '../pricing/pricing.repository.js';

export function createPayments(prisma: PrismaClient, bookings: FinancialBookings, options?: RazorpayOptions, pricing?:PricingRepository) {
  pricing?.assertProvider(options?.keyId??'');
  const unavailable = (): never => { throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Payments are not configured.'); };
  const provider: PaymentProvider = options ? new RazorpayProvider(options) : {
    keyId: '', createOrder: async () => unavailable(), findOrder: async () => unavailable(),
    fetchOrder: async () => unavailable(), fetchPayment: async () => unavailable(),
    createRefund: async () => unavailable(), fetchRefund: async () => unavailable(),
    verifyCheckoutSignature: unavailable, parseWebhook: unavailable,
  };
  const refunds = new RefundService(new RefundRepository(prisma), bookings, provider);
  return { payments: new PaymentService(new PaymentRepository(prisma,pricing), bookings, provider, refunds), refunds };
}
