import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { schedulingWrite, hasSqlState } from '../shows/scheduling-write.js';

export async function bookingWrite<T>(operation: () => Promise<T>): Promise<T> {
  return schedulingWrite(async () => {
    try { return await operation(); }
    catch (error) {
      if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') || hasSqlState(error, '23505')) {
        throw new AppError(409, 'SEAT_BOOKED', 'One or more selected seats are already booked.');
      }
      throw error;
    }
  });
}
