import type { PrismaClient } from '../../generated/prisma/client.js';
import type { PasswordRecoveryUsers } from './password-reset.types.js';

const select = { id: true, email: true, passwordHash: true } as const;
export class PasswordResetRepository implements PasswordRecoveryUsers {
  constructor(private readonly prisma: PrismaClient) {}
  findByEmail(email: string) { return this.prisma.user.findUnique({ where: { email }, select }); }
  findById(id: string) { return this.prisma.user.findUnique({ where: { id }, select }); }
  async replacePassword(id: string, expectedHash: string, passwordHash: string) {
    // A second recovery link or concurrent reset cannot overwrite the new credential.
    const result = await this.prisma.user.updateMany({ where: { id, passwordHash: expectedHash }, data: { passwordHash } });
    return result.count === 1;
  }
}
