import type { PrismaClient } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { publicSelect } from './user.repository.js';
import { toPublicUser } from './auth.types.js';

export interface OwnershipSnapshot {
  id: string; email: string; passwordHash: string | null; googleSubject: string | null;
  authVersion: number; emailVerifiedAt: Date | null; authDisabledAt: Date | null;
}
export class OwnershipRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email }, select: ownershipSelect });
  }
  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id }, select: ownershipSelect });
  }
  async authSnapshot(id: string) {
    const user = await this.findById(id);
    return user ? { ...toPublicUser(user), authVersion: user.authVersion,
      emailVerifiedAt: user.emailVerifiedAt, authDisabledAt: user.authDisabledAt,
      providerOnly: Boolean(user.googleSubject && user.passwordHash === null) } : null;
  }
  async createVerified(input: { name: string; email: string; passwordHash: string }) {
    try { return await this.prisma.user.create({ data: { ...input, role: 'USER', emailVerifiedAt: new Date() }, select: ownershipSelect }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict(); throw error; }
  }
  async verifyLegacy(expected: OwnershipSnapshot, passwordHash: string) {
    if (expected.emailVerifiedAt || expected.authDisabledAt || !expected.passwordHash) throw conflict();
    return this.changePassword(expected, passwordHash);
  }
  async resetVerified(expected: OwnershipSnapshot, passwordHash: string) {
    if (!expected.emailVerifiedAt || expected.authDisabledAt) throw conflict();
    return this.changePassword(expected, passwordHash);
  }
  private async changePassword(expected: OwnershipSnapshot, passwordHash: string) {
    return this.prisma.$transaction(async tx => {
      const updated = await tx.user.updateMany({ where: statePredicate(expected),
        data: { passwordHash, emailVerifiedAt: expected.emailVerifiedAt ?? new Date(), authVersion: { increment: 1 } } });
      if (updated.count !== 1) throw conflict();
      return tx.user.findUniqueOrThrow({ where: { id: expected.id }, select: ownershipSelect });
    });
  }
  async cleanStart(expected: OwnershipSnapshot, input: { name: string; passwordHash: string }) {
    if (expected.emailVerifiedAt || expected.authDisabledAt || expected.googleSubject || !expected.passwordHash) {
      throw conflict();
    }
    try {
      return await this.prisma.$transaction(async tx => {
        // UPDATE locks the row. PostgreSQL rechecks this predicate after waiting
        // for a concurrent recovery/link winner; never quarantine a new binding.
        const changed = await tx.user.updateMany({ where: {
          id: expected.id, email: expected.email, passwordHash: expected.passwordHash,
          authVersion: expected.authVersion, emailVerifiedAt: null, authDisabledAt: null, googleSubject: null,
        }, data: { email: `${randomUUID()}@quarantined.invalid`, passwordHash: null,
          authDisabledAt: new Date(), authVersion: { increment: 1 } } });
        if (changed.count !== 1) throw conflict();
        const replacement = await tx.user.create({ data: {
          name: input.name, email: expected.email, passwordHash: input.passwordHash,
          role: 'USER', emailVerifiedAt: new Date(),
        }, select: { ...publicSelect, emailVerifiedAt: true, authVersion: true, authDisabledAt: true } });
        await tx.accountQuarantine.create({ data: { originalUserId: expected.id,
          replacementUserId: replacement.id, originalEmail: expected.email, reason: 'UNVERIFIED_EMAIL_CLEAN_START' } });
        return replacement;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw conflict();
      throw error;
    }
  }
}
function conflict() { return new AppError(409, 'OWNERSHIP_CONFLICT', 'Account recovery could not be completed. Start again.'); }
export const ownershipSelect = { ...publicSelect, passwordHash: true, googleSubject: true,
  authVersion: true, emailVerifiedAt: true, authDisabledAt: true } as const;
export function statePredicate(expected: OwnershipSnapshot) {
  return { id: expected.id, email: expected.email, passwordHash: expected.passwordHash, googleSubject: expected.googleSubject,
    authVersion: expected.authVersion, emailVerifiedAt: expected.emailVerifiedAt, authDisabledAt: null };
}
