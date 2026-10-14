import {Prisma,type PrismaClient} from '../../generated/prisma/client.js';
import {RefundRepository} from '../refunds/refund.repository.js';
import {releaseUnpaidOffer} from '../pricing/release-unpaid-offer.js';

/** Caller holds the cancelled Booking row lock; no provider/Redis calls here. */
export async function settleExpiredCheckout(prisma:PrismaClient,tx:Prisma.TransactionClient,userId:string,bookingId:string){
  const reference=await tx.payment.findUnique({where:{bookingId},select:{id:true}});
  if(reference){
    await tx.$queryRaw(Prisma.sql`SELECT id FROM payments WHERE id=${reference.id}::uuid FOR UPDATE`);
    const payment=await tx.payment.findUniqueOrThrow({where:{id:reference.id}});
    if(payment.capturedAt){
      if(!payment.bookingFinalizedAt)await tx.$executeRaw(Prisma.sql`UPDATE payments SET booking_finalized_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=${payment.id}::uuid AND booking_finalized_at IS NULL`);
      await new RefundRepository(prisma).prepareInTransaction(tx,payment.id);
    }
  }
  await releaseUnpaidOffer(tx,userId,bookingId);
}
