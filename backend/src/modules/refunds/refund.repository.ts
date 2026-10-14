import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type RefundAttempt } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { BookingRepository } from '../booking/booking.repository.js';
import { EventBookingRepository } from '../event-booking/event-booking.repository.js';
import { bookingScope } from '../booking/booking-scope.js';
import type { BookingConfirmationScope } from '../booking/booking.types.js';
import type { PaymentEvent, PaymentRecord } from '../payments/payment.types.js';
import { paymentWrite } from '../payments/payment-write.js';
import type { ProviderRefund } from '../payments/payment-provider.js';
import type { RefundRecord, RefundStore } from './refund.types.js';

const options = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 7000 };
const include = { reconciliation: true, booking: { select: { userId: true, status: true, expiresAt: true } } } as const;
const refundInclude = { attempts: { orderBy: { sequence: 'desc' as const } } } as const;
const missing = () => new AppError(404, 'NOT_FOUND', 'Booking payment not found.');
const conflict = () => new AppError(409, 'REFUND_CONFLICT', 'Refund identity conflicts with stored evidence.');

export class RefundRepository implements RefundStore {
  constructor(private readonly prisma: PrismaClient) {}
  private run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) { return paymentWrite(() => this.prisma.$transaction(work, options)); }
  private async clock(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<{ epochMs: bigint }[]>(Prisma.sql`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS "epochMs"`);
    return new Date(Number(rows[0]!.epochMs));
  }
  private async lock(tx: Prisma.TransactionClient, paymentId: string): Promise<PaymentRecord> {
    const ref = await tx.payment.findUnique({ where: { id: paymentId }, select: { bookingId: true } }); if (!ref) throw missing();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id=${ref.bookingId}::uuid FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM payments WHERE id=${paymentId}::uuid FOR UPDATE`);
    const value = await tx.payment.findUnique({ where: { id: paymentId }, include }); if (!value) throw missing(); return value;
  }
  private async lockRefund(tx: Prisma.TransactionClient, id: string) {
    const ref = await tx.refund.findUnique({ where: { id }, select: { paymentId: true } }); if (!ref) throw missing();
    const payment = await this.lock(tx, ref.paymentId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM refunds WHERE id=${id}::uuid FOR UPDATE`);
    const refund = await tx.refund.findUnique({ where: { id }, include: refundInclude }); if (!refund) throw missing(); return { payment, refund };
  }
  private async refresh(tx: Prisma.TransactionClient, payment: PaymentRecord) {
    const sources = await tx.paymentEvidence.findMany({ where: { paymentId: payment.id, captured: true }, include: { refund: true } });
    const all = payment.booking.status === 'FAILED' || payment.booking.status === 'CANCELLED';
    const required = sources.filter(source => all || source.providerPaymentId !== payment.providerPaymentId);
    const complete = required.length > 0 && required.every(source => source.refund?.status === 'REFUNDED');
    if (all && sources.length) {
      // Preserve the specified intermediate transition even if evidence was
      // already returned before this aggregate was refreshed.
      if (payment.status === 'SUCCESS') await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUND_PENDING' } });
      const target = complete ? 'REFUNDED' : 'REFUND_PENDING';
      if (payment.status !== target) await tx.payment.update({ where: { id: payment.id }, data: { status: target } });
    }
    if (complete && payment.reconciliation && !payment.reconciliation.resolvedAt) {
      await tx.paymentReconciliation.update({ where: { paymentId: payment.id }, data: { resolvedAt: await this.clock(tx) } });
    }
  }
  private async seed(tx: Prisma.TransactionClient, paymentId: string) {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include }); if (!payment) throw missing();
    const all = payment.booking.status === 'FAILED' || payment.booking.status === 'CANCELLED';
    if (!all && payment.booking.status !== 'CONFIRMED') return;
    const sources = await tx.paymentEvidence.findMany({ where: { paymentId, captured: true }, orderBy: { providerPaymentId: 'asc' } });
    const required = sources.filter(source => all || source.providerPaymentId !== payment.providerPaymentId);
    if (!required.length) return;
    const reason = payment.booking.status === 'CANCELLED' ? 'BOOKING_CANCELLED' : all ? 'BOOKING_UNFULFILLED' : 'DUPLICATE_CAPTURE';
    for (const source of required) {
      await tx.refund.upsert({ where: { providerPaymentId: source.providerPaymentId },
        create: { paymentId, providerPaymentId: source.providerPaymentId, amountPaise: source.amountPaise, currency: source.currency, reason }, update: {} });
    }
    const unfinished = await tx.refund.count({ where: { paymentId, status: 'PENDING' } });
    await tx.paymentReconciliation.upsert({ where: { paymentId }, create: { paymentId, reason, compensationRequired: true },
      update: { compensationRequired: true, ...(payment.reconciliation?.reason === 'FULFILLMENT_PENDING' ? { reason } : {}),
        ...(unfinished ? { resolvedAt: null } : {}) } });
    const updated = (await tx.payment.findUnique({ where: { id: paymentId }, include }))!;
    await this.refresh(tx, updated);
  }
  cancel(userId: string, bookingId: string, work: (scope: BookingConfirmationScope) => Promise<unknown>) {
    return this.run(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id=${bookingId}::uuid FOR UPDATE`);
      const ref = await tx.payment.findUnique({ where: { bookingId }, include });
      if (!ref || ref.booking.userId !== userId) throw missing();
      const payment = await this.lock(tx, ref.id);
      if (!payment.capturedAt) throw new AppError(409, 'PAYMENT_STATE', 'Payment is not captured.');
      await work(bookingScope(this.prisma, tx, () => {}));
      await this.seed(tx, payment.id); return payment.id;
    });
  }
  async cancelCheckout(userId:string, bookingId:string, work:(scope:BookingConfirmationScope)=>Promise<unknown>) {
    const callbacks:(()=>Promise<void>)[]=[];
    const result=await this.run(async tx=>{
      await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id=${bookingId}::uuid FOR UPDATE`);
      const booking=await tx.booking.findUnique({where:{id:bookingId}});
      if(!booking||booking.userId!==userId)throw new AppError(404,'NOT_FOUND','Booking not found.');
      const ref=await tx.payment.findUnique({where:{bookingId}});
      const payment=ref?await this.lock(tx,ref.id):null;
      await work(bookingScope(this.prisma,tx,callback=>callbacks.push(callback)));
      if(payment?.capturedAt) {
        // Cancellation can win between capture and fulfillment. Finalize the
        // unfulfilled outcome and its refund obligation in this same commit.
        if(!payment.bookingFinalizedAt)await tx.payment.update({where:{id:payment.id},data:{bookingFinalizedAt:await this.clock(tx)}});
        await this.seed(tx,payment.id);
      }
      const current=await tx.booking.findUniqueOrThrow({where:{id:bookingId},select:{id:true,status:true}});
      return {booking:current,paymentId:payment?.id??null};
    });
    await Promise.allSettled(callbacks.map(callback=>callback()));
    return result;
  }
  async prepare(id: string) { await this.run(async tx => { await this.lock(tx, id); await this.seed(tx, id); }); }
  // Financial writers already own Booking -> Payment locks. Reuse their short
  // transaction so late captures cannot commit without refund obligations.
  async prepareInTransaction(tx:Prisma.TransactionClient,id:string) {await this.seed(tx,id);}
  owned(userId: string, bookingId: string) {
    return this.run(async tx => {
      const ref = await tx.payment.findUnique({ where: { bookingId }, select: { id: true, booking: { select: { userId: true } } } });
      if (!ref || ref.booking.userId !== userId) return null;
      const payment = await this.lock(tx, ref.id);
      const target = await tx.booking.findUnique({ where: { id: bookingId }, select: { bookingKind: true } });
      const booking = target?.bookingKind === 'EVENT'
        ? await new EventBookingRepository(this.prisma).withTransaction(tx).findById(bookingId)
        : await new BookingRepository(this.prisma).withTransaction(tx).findById(bookingId);
      if (!booking) return null;
      return { booking, payment, refunds: await tx.refund.findMany({ where: { paymentId: payment.id }, include: refundInclude, orderBy: { id: 'asc' } }) };
    });
  }
  pending(paymentId: string) { return this.prisma.refund.findMany({ where: { paymentId, status: 'PENDING' }, include: refundInclude, orderBy: { id: 'asc' } }); }
  private newAttempt(tx: Prisma.TransactionClient, refund: RefundRecord) {
    const id = randomUUID(); return tx.refundAttempt.create({ data: { id, refundId: refund.id, sequence: (refund.attempts[0]?.sequence ?? 0) + 1, receipt: id } });
  }
  attempt(id: string) { return this.run(async tx => { const { refund } = await this.lockRefund(tx, id); return refund.status === 'REFUNDED' ? null : refund.attempts[0] ?? this.newAttempt(tx, refund); }); }
  retryAttempt(id: string, failedProviderId: string) {
    return this.run(async tx => {
      const { refund } = await this.lockRefund(tx, id); if (refund.status === 'REFUNDED') return null;
      const latest = refund.attempts[0]; if (!latest) throw conflict();
      return latest.status === 'FAILED' && latest.providerRefundId === failedProviderId ? this.newAttempt(tx, refund) : latest;
    });
  }
  private async event(tx: Prisma.TransactionClient, event: PaymentEvent, paymentId: string | null) {
    const previous = await tx.paymentWebhookEvent.findUnique({ where: { providerEventId: event.id } });
    if (previous) {
      if (previous.digest !== event.digest || previous.eventType !== event.type || previous.paymentId !== paymentId
        || previous.providerPaymentId !== event.providerPaymentId || previous.providerRefundId !== (event.providerRefundId ?? null)) throw conflict();
      return previous;
    }
    return tx.paymentWebhookEvent.create({ data: { providerEventId: event.id, digest: event.digest, eventType: event.type,
      paymentId, providerPaymentId: event.providerPaymentId, providerRefundId: event.providerRefundId ?? null } });
  }
  async record(id: string, attemptId: string, evidence: ProviderRefund, event?: PaymentEvent) {
    await this.run(async tx => {
      const { payment, refund } = await this.lockRefund(tx, id);
      const attempt = refund.attempts.find(value => value.id === attemptId); if (!attempt) throw conflict();
      if (evidence.paymentId !== refund.providerPaymentId || BigInt(evidence.amountPaise) !== refund.amountPaise || evidence.currency !== refund.currency
        || evidence.receipt !== attempt.receipt || (attempt.providerRefundId && attempt.providerRefundId !== evidence.id)) throw conflict();
      const receipt = event ? await this.event(tx, event, payment.id) : null;
      const status = attempt.status === 'PROCESSED' ? 'PROCESSED' : evidence.status === 'processed' ? 'PROCESSED'
        : attempt.status === 'FAILED' || evidence.status === 'failed' ? 'FAILED' : 'PENDING';
      const processedAt = status === 'PROCESSED' ? attempt.processedAt ?? await this.clock(tx) : null;
      await tx.refundAttempt.update({ where: { id: attempt.id }, data: { providerRefundId: evidence.id, status, processedAt, lastErrorCode: status === 'FAILED' ? 'PROVIDER_REFUND_FAILED' : null } });
      if (status === 'PROCESSED' && refund.status !== 'REFUNDED') await tx.refund.update({ where: { id }, data: { status: 'REFUNDED' } });
      await this.refresh(tx, payment);
      if (receipt && !receipt.processedAt) await tx.paymentWebhookEvent.update({ where: { providerEventId: receipt.providerEventId }, data: { processedAt: await this.clock(tx) } });
    });
  }
  async noteFailure(attemptId: string, code: string) {
    await this.run(async tx => {
      const attempt = await tx.refundAttempt.findUnique({ where: { id: attemptId } }); if (!attempt) throw missing();
      await this.lockRefund(tx, attempt.refundId);
      await tx.refundAttempt.update({ where: { id: attemptId }, data: { lastErrorCode: /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'REFUND_DEPENDENCY_UNAVAILABLE' } });
    });
  }
  async binding(evidence: ProviderRefund) {
    const attempt = await this.prisma.refundAttempt.findFirst({ where: { OR: [{ providerRefundId: evidence.id }, ...(evidence.receipt ? [{ receipt: evidence.receipt }] : [])] },
      include: { refund: { include: refundInclude } } });
    return attempt ? { attempt, refund: attempt.refund } : null;
  }
  async ignoreEvent(event: PaymentEvent) { await this.run(async tx => { const receipt = await this.event(tx, event, null);
    if (!receipt.processedAt) await tx.paymentWebhookEvent.update({ where: { providerEventId: event.id }, data: { processedAt: await this.clock(tx) } }); }); }
  async candidates(limit: number) {
    return this.run(async tx => {
      // Rotate examined obligations durably, even if provider delivery remains
      // pending. Lock Booking first (the financial writers' lock order), skipping
      // work currently owned by another transaction. This is scheduling metadata,
      // not a refund claim/lease: provider attempt identities still enforce safety.
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT p.id FROM payments p JOIN bookings b ON b.id=p.booking_id
        WHERE p.status='REFUND_PENDING'
          OR EXISTS(SELECT 1 FROM refunds r WHERE r.payment_id=p.id AND r.status='PENDING')
          OR EXISTS(SELECT 1 FROM payment_reconciliations c WHERE c.payment_id=p.id
                    AND c.compensation_required AND c.resolved_at IS NULL)
        ORDER BY p.updated_at, p.id LIMIT ${limit} FOR UPDATE OF b SKIP LOCKED`);
      const ids = rows.map(row => row.id);
      if (ids.length) await tx.payment.updateMany({ where: { id: { in: ids } }, data: { updatedAt: await this.clock(tx) } });
      return ids;
    });
  }
}
