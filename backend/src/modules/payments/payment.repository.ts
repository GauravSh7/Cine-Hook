import { randomUUID } from 'node:crypto';
import { PricingRepository } from '../pricing/pricing.repository.js';
import { RefundRepository } from '../refunds/refund.repository.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { bookingScope } from '../booking/booking-scope.js';
import type { BookingConfirmationScope } from '../booking/booking.types.js';
import type { ProviderOrder, ProviderPayment } from './payment-provider.js';
import type { Fulfillment, PaymentEvent, PaymentRecord, PaymentStore } from './payment.types.js';
import { paymentWrite } from './payment-write.js';

const include = { reconciliation: true, booking: { select: { userId: true, status: true, expiresAt: true } } } as const;
const options = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 7000 };
const missing = () => new AppError(404, 'NOT_FOUND', 'Payment not found.');
const conflict = () => new AppError(409, 'PAYMENT_CONFLICT', 'Provider evidence does not match this payment.');

export class PaymentRepository implements PaymentStore {
  constructor(private readonly prisma: PrismaClient, private readonly pricing = new PricingRepository(prisma)) {}

  private async lock(tx: Prisma.TransactionClient, id: string): Promise<PaymentRecord> {
    const reference = await tx.payment.findUnique({ where: { id }, select: { bookingId: true } });
    if (!reference) throw missing();
    // Every writer uses the same order, including the scoped Booking repository.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id=${reference.bookingId}::uuid FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM payments WHERE id=${id}::uuid FOR UPDATE`);
    const payment = await tx.payment.findUnique({ where: { id }, include });
    if (!payment) throw missing();
    return payment;
  }

  private async clock(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<{ epochMs: bigint }[]>(Prisma.sql`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS "epochMs"`);
    return new Date(Number(rows[0]!.epochMs));
  }

  reserve(userId: string, bookingId: string) {
    return paymentWrite(() => this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id=${bookingId}::uuid FOR UPDATE`);
      const booking = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!booking || booking.userId !== userId) throw missing();
      if (booking.status !== 'PENDING' || booking.expiresAt <= await this.clock(tx)) {
        throw new AppError(409, 'BOOKING_STATE', 'This booking cannot start a payment.');
      }
      const existing = await tx.payment.findUnique({ where: { bookingId }, include });
      if (existing) {
        // A controlled reservation must not become a real-provider order merely
        // because it already exists. Read provenance; never reprice its history.
        const quote = await tx.bookingPricingQuote.findUnique({where:{bookingId}});
        await this.pricing.assertPaymentAllowed(tx,quote?.breakdown);
        return existing;
      }
      const id = randomUUID();
      const amountPaise = await this.pricing.freeze(tx, booking);
      return tx.payment.create({ data: { id, bookingId, receipt: id, amountPaise, currency: 'INR' }, include });
    }, options));
  }

  attachOrder(id: string, order: ProviderOrder) {
    return paymentWrite(() => this.prisma.$transaction(async tx => {
      const payment = await this.lock(tx, id);
      if (payment.receipt !== order.receipt || payment.amountPaise !== BigInt(order.amountPaise) || payment.currency !== order.currency
        || (payment.providerOrderId && payment.providerOrderId !== order.id)) throw conflict();
      if (payment.providerOrderId) return payment;
      return tx.payment.update({ where: { id }, data: { providerOrderId: order.id }, include });
    }, options));
  }

  findByBooking(bookingId: string) { return this.prisma.payment.findUnique({ where: { bookingId }, include }); }
  findByOrder(providerOrderId: string) { return this.prisma.payment.findUnique({ where: { providerOrderId }, include }); }
  findByReceipt(receipt: string) { return this.prisma.payment.findUnique({ where: { receipt }, include }); }

  private async event(tx: Prisma.TransactionClient, event: PaymentEvent, paymentId: string | null) {
    const existing = await tx.paymentWebhookEvent.findUnique({ where: { providerEventId: event.id } });
    if (existing) {
      if (existing.digest !== event.digest || existing.eventType !== event.type || existing.paymentId !== paymentId
        || existing.providerPaymentId !== event.providerPaymentId || existing.providerRefundId !== (event.providerRefundId ?? null)) throw conflict();
      return existing;
    }
    return tx.paymentWebhookEvent.create({ data: { providerEventId: event.id, digest: event.digest, eventType: event.type,
      paymentId, providerPaymentId: event.providerPaymentId, providerRefundId: event.providerRefundId ?? null } });
  }

  recordEvidence(id: string, evidence: ProviderPayment, event?: PaymentEvent) {
    return paymentWrite(() => this.prisma.$transaction(async tx => {
      const payment = await this.lock(tx, id);
      if (payment.providerOrderId !== evidence.orderId || payment.amountPaise !== BigInt(evidence.amountPaise) || payment.currency !== evidence.currency) throw conflict();
      if (event) await this.event(tx, event, id);
      const previous = await tx.paymentEvidence.findUnique({ where: { providerPaymentId: evidence.id } });
      if (previous && previous.paymentId !== id) throw conflict();
      const captured = evidence.status === 'captured' && evidence.captured;
      const failed = evidence.status === 'failed';
      const financiallyCaptured = ['SUCCESS', 'REFUND_PENDING', 'REFUNDED'].includes(payment.status);
      await tx.paymentEvidence.upsert({ where: { providerPaymentId: evidence.id },
        create: { providerPaymentId: evidence.id, paymentId: id, amountPaise: payment.amountPaise, currency: payment.currency, captured, failureSeen: failed },
        update: { captured: captured || previous?.captured || false, failureSeen: failed || previous?.failureSeen || false } });
      if (captured) {
        if (!financiallyCaptured) {
          await tx.payment.update({ where: { id }, data: { status: 'SUCCESS', providerPaymentId: evidence.id,
            capturedAt: await this.clock(tx), failureCode: null } });
          await tx.paymentReconciliation.upsert({ where: { paymentId: id },
            create: { paymentId: id, reason: 'FULFILLMENT_PENDING', compensationRequired: false }, update: {} });
        } else if (payment.providerPaymentId !== evidence.id && !previous?.captured && payment.bookingFinalizedAt) {
          await tx.paymentReconciliation.upsert({ where: { paymentId: id },
            create: { paymentId: id, reason: 'DUPLICATE_CAPTURE', compensationRequired: true },
            update: { reason: payment.reconciliation?.reason ?? 'DUPLICATE_CAPTURE', compensationRequired: true, resolvedAt: null } });
          if (payment.status === 'REFUNDED') await tx.payment.update({ where: { id }, data: { status: 'REFUND_PENDING' } });
        }
      } else if (failed && !financiallyCaptured) {
        await tx.payment.update({ where: { id }, data: { status: 'FAILED', failureCode: 'PROVIDER_FAILED' } });
        // Booking lock is already held. Cancellation is durable before a late
        // capture can enter; that capture will create compensation, not seats.
        await tx.booking.updateMany({where:{id:payment.bookingId,status:'PENDING'},data:{status:'CANCELLED',failureCode:'PAYMENT_FAILED'}});
      }
      if(captured && (payment.booking.status==='CANCELLED'||payment.booking.status==='FAILED')) {
        const current=await tx.payment.findUniqueOrThrow({where:{id}});
        if(!current.bookingFinalizedAt)await tx.payment.update({where:{id},data:{bookingFinalizedAt:await this.clock(tx)}});
        await new RefundRepository(this.prisma).prepareInTransaction(tx,id);
      }
      return (await tx.payment.findUnique({ where: { id }, include }))!;
    }, options));
  }

  async finalize(id: string, work: (scope: BookingConfirmationScope) => Promise<Fulfillment>) {
    const callbacks: (() => Promise<void>)[] = [];
    const result = await paymentWrite(() => this.prisma.$transaction(async tx => {
      const payment = await this.lock(tx, id);
      if (payment.status !== 'SUCCESS' || payment.bookingFinalizedAt) return payment;
      const disposition = await work(bookingScope(this.prisma, tx, callback => callbacks.push(callback)));
      const captures = await tx.paymentEvidence.count({ where: { paymentId: id, captured: true } });
      if (disposition.confirmed && captures === 1) {
        await tx.paymentReconciliation.deleteMany({ where: { paymentId: id, compensationRequired: false } });
      } else {
        const reason = disposition.confirmed ? 'DUPLICATE_CAPTURE' : disposition.reason ?? 'FULFILLMENT_FAILED';
        await tx.paymentReconciliation.upsert({ where: { paymentId: id }, create: { paymentId: id, reason, compensationRequired: true },
          update: { reason, compensationRequired: true } });
      }
      return tx.payment.update({ where: { id }, data: { bookingFinalizedAt: await this.clock(tx) }, include });
    }, options));
    // Deferred PostgreSQL constraints have passed; only now may Redis be cleared.
    await Promise.allSettled(callbacks.map(callback => callback()));
    return result;
  }

  async markEventProcessed(event: PaymentEvent, paymentId: string | null) {
    await paymentWrite(() => this.prisma.$transaction(async tx => {
      if (paymentId) await this.lock(tx, paymentId);
      const record = await this.event(tx, event, paymentId);
      if (!record.processedAt) await tx.paymentWebhookEvent.update({ where: { providerEventId: event.id }, data: { processedAt: await this.clock(tx) } });
    }, options));
  }
}
