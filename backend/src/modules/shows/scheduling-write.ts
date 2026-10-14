import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { databaseWrite } from '../catalog/database-write.js';

export function hasSqlState(value: unknown, code: string, depth = 0): boolean {
  if (depth > 6 || !value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) =>
    (['code', 'originalCode', 'sqlState'].includes(key) && nested === code) || hasSqlState(nested, code, depth + 1));
}

export async function schedulingWrite<T>(operation: () => Promise<T>): Promise<T> {
  try { return await databaseWrite(operation, 'Scheduling resource'); }
  catch (error) {
    // Interactive-transaction COMMIT can surface a native adapter error rather
    // than PrismaClientKnownRequestError. The same SQL constraints still apply.
    if (hasSqlState(error, '23P01')) throw new AppError(409, 'SHOW_OVERLAP', 'The screen already has a show in this time interval.');
    if (hasSqlState(error, '23514')) throw new AppError(409, 'DEPENDENCY_CONFLICT', 'The change conflicts with the inventory or scheduled session.');
    if (hasSqlState(error, '40P01') || hasSqlState(error, '40001')) throw new AppError(409, 'CONCURRENT_CHANGE', 'A concurrent change occurred. Retry the request.');
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (hasSqlState(error.meta, '23P01')) throw new AppError(409, 'SHOW_OVERLAP', 'The screen already has a show in this time interval.');
      if (hasSqlState(error.meta, '23514') || error.code === 'P2004') {
        throw new AppError(409, 'DEPENDENCY_CONFLICT', 'The change conflicts with the screen layout or scheduled shows.');
      }
      if (error.code === 'P2034' || hasSqlState(error.meta, '40P01')) {
        throw new AppError(409, 'CONCURRENT_CHANGE', 'A concurrent change occurred. Retry the request.');
      }
    }
    throw error;
  }
}
