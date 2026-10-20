import type { PrismaClient } from '../../generated/prisma/client.js';
import type { PasswordRecoveryUsers } from './password-reset.types.js';

const select = { id: true, email: true, passwordHash: true, googleSubject: true, authVersion: true, emailVerifiedAt: true, authDisabledAt: true } as const;
export class PasswordResetRepository implements PasswordRecoveryUsers {
  constructor(private readonly prisma: PrismaClient) {}
  findByEmail(email: string) { return this.prisma.user.findUnique({ where: { email }, select }); }
  findById(id: string) { return this.prisma.user.findUnique({ where: { id }, select }); }
  async replacePassword(id: string, expectedHash: string | null, passwordHash: string, expectedVersion: number) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return false;
    // A second recovery link or concurrent reset cannot overwrite the new credential.
    const result = await this.prisma.user.updateMany({
      where: { id, passwordHash: expectedHash, authVersion: expectedVersion, authDisabledAt: null, emailVerifiedAt: { not: null }, ...(expectedHash === null ? { googleSubject: { not: null } } : {}) },
      data: { passwordHash, authVersion: { increment: 1 } },
    });
    return result.count === 1;
  }
}
