import { describe, expect, it } from 'vitest';
import { OwnershipRepository } from '../src/modules/auth/ownership.repository.js';

// Database behavior, unique constraints and rollback are exercised by the
// companion isolated PostgreSQL integration test, not simulated Prisma writes.
describe('ownership repository', () => {
  it('rejects quarantine when the expected snapshot already has a provider identity', async () => {
    const repo = new OwnershipRepository({ $transaction: () => { throw new Error('must not query'); } } as never);
    await expect(repo.cleanStart({ id: 'x', email: 'a@example.test', authVersion: 0,
      emailVerifiedAt: null, authDisabledAt: null, googleSubject: 'bound', passwordHash: 'hash' },
    { name: 'Owner', passwordHash: 'new' })).rejects.toMatchObject({ code: 'OWNERSHIP_CONFLICT' });
  });
  it('rejects quarantine of an already verified account before any mutation', async () => {
    const repo = new OwnershipRepository({ $transaction: () => { throw new Error('must not query'); } } as never);
    await expect(repo.cleanStart({ id: 'x', email: 'a@example.test', authVersion: 0,
      emailVerifiedAt: new Date(), authDisabledAt: null, googleSubject: null, passwordHash: 'hash' },
    { name: 'Owner', passwordHash: 'new' })).rejects.toMatchObject({ code: 'OWNERSHIP_CONFLICT' });
  });
});
