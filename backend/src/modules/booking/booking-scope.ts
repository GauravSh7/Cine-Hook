import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { BookingRepository } from './booking.repository.js';
import { EventBookingRepository } from '../event-booking/event-booking.repository.js';
import type { BookingConfirmationScope } from './booking.types.js';

export function bookingScope(prisma: PrismaClient, tx: Prisma.TransactionClient, afterCommit: BookingConfirmationScope['afterCommit']): BookingConfirmationScope {
  return { store: new BookingRepository(prisma).withTransaction(tx), eventStore: new EventBookingRepository(prisma).withTransaction(tx), afterCommit,
    target: async id => (await tx.booking.findUnique({ where: { id }, select: { bookingKind: true } }))?.bookingKind ?? null };
}
