import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';

export async function databaseWrite<T>(operation: () => Promise<T>, resource: string): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new AppError(409, 'DUPLICATE_RESOURCE', `${resource} already exists.`);
      if (error.code === 'P2003') throw new AppError(409, 'PARENT_CONFLICT', 'The referenced parent is unavailable.');
      if (error.code === 'P2025') throw new AppError(404, 'NOT_FOUND', `${resource} not found.`);
    }
    throw error;
  }
}
