import { expect, it } from 'vitest';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { UserRepository } from '../src/modules/auth/user.repository.js';

const input = { name: 'Gaurav', email: 'gaurav@example.com', passwordHash: 'test-hash' };
function failingRepository(error: Error) {
  // Substitute only the external Prisma operation; real repository error mapping runs.
  const prisma = { user: { create: async () => { throw error; } } } as unknown as PrismaClient;
  return new UserRepository(prisma);
}
it('maps Prisma unique constraint failures to safe duplicate-email errors', async () => {
  const error = new Prisma.PrismaClientKnownRequestError('private constraint details', { code: 'P2002', clientVersion: '7.10.0' });
  await expect(failingRepository(error).create(input)).rejects.toMatchObject({ status: 409, code: 'EMAIL_EXISTS' });
});
it('does not misclassify unrelated database failures as duplicates', async () => {
  const error = new Error('connection failure');
  await expect(failingRepository(error).create(input)).rejects.toBe(error);
});
