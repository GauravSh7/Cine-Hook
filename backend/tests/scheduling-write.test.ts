import { expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma/client.js';
import { schedulingWrite } from '../src/modules/shows/scheduling-write.js';

it.each([
  ['23514', 'DEPENDENCY_CONFLICT'], ['23P01', 'SHOW_OVERLAP'], ['40P01', 'CONCURRENT_CHANGE'],
])('translates PostgreSQL %s behind an adapter error without exposing SQL', async (sqlState, safeCode) => {
  const failure = new Prisma.PrismaClientKnownRequestError('private SQL details', {
    code: 'P2039', clientVersion: '7.10.0', meta: { driverAdapterError: { cause: { originalCode: sqlState } } },
  });
  await expect(schedulingWrite(async () => { throw failure; })).rejects.toMatchObject({ status: 409, code: safeCode });
  try { await schedulingWrite(async () => { throw failure; }); }
  catch (error) { expect((error as Error).message).not.toContain('private SQL details'); }
});

it('does not relabel operational database failures as domain conflicts', async () => {
  const failure = new Prisma.PrismaClientKnownRequestError('database connection unavailable', {
    code: 'P2039', clientVersion: '7.10.0', meta: { driverAdapterError: { cause: { originalCode: '53300' } } },
  });
  await expect(schedulingWrite(async () => { throw failure; })).rejects.toBe(failure);
});
