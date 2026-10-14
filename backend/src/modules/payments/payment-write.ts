import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { schedulingWrite, hasSqlState } from '../shows/scheduling-write.js';

export async function paymentWrite<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await schedulingWrite(async () => {
      try { return await operation(); }
      catch (error) {
        if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') || hasSqlState(error, '23505')) {
          throw new AppError(409, 'PAYMENT_CONFLICT', 'The provider identity conflicts with an existing payment.');
        }
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'DEPENDENCY_CONFLICT') {
      throw new AppError(409, 'PAYMENT_CONFLICT', 'The payment conflicts with verified evidence or booking state.');
    }
    throw error;
  }
}
