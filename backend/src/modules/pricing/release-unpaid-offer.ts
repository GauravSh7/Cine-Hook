import { Prisma } from '../../generated/prisma/client.js';

// The caller owns the booking lock. An issued/uncertain order may still capture;
// a failed payment attempt is not proof that its entire order has been closed.
export async function releaseUnpaidOffer(tx: Prisma.TransactionClient, userId: string, bookingId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`);
  if (await tx.payment.count({where:{bookingId}})) return;
  await tx.firstBookingOffer.updateMany({where:{userId,reservedBookingId:bookingId,consumedAt:null},data:{reservedBookingId:null}});
}
