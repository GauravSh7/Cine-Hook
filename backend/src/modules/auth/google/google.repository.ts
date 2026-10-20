import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { AppError } from '../../../errors/app-error.js';
import { toPublicUser } from '../auth.types.js';
import { ownershipSelect } from '../ownership.repository.js';
import type { GoogleUserStore } from './google.types.js';

const project = (user: Prisma.UserGetPayload<{ select: typeof ownershipSelect }>) => ({ ...toPublicUser(user),
  authVersion: user.authVersion, emailVerifiedAt: user.emailVerifiedAt, authDisabledAt: user.authDisabledAt, passwordHash: user.passwordHash });
const conflict = () => new AppError(409, 'GOOGLE_IDENTITY_CONFLICT', 'Google account ownership changed. Sign in again.');
export class GoogleUserRepository implements GoogleUserStore {
  constructor(private readonly prisma: PrismaClient) {}
  async findBySubject(googleSubject: string) { const user = await this.prisma.user.findUnique({ where: { googleSubject }, select: ownershipSelect }); return user ? project(user) : null; }
  findByEmail(email: string) { return this.prisma.user.findUnique({ where: { email }, select: ownershipSelect }); }
  async linkGoogle(input: { userId: string; googleSubject: string; email: string; passwordHash: string; authVersion: number }) {
    return this.mutate(async tx => {
      const changed = await tx.user.updateMany({ where: { id: input.userId, email: input.email, passwordHash: input.passwordHash,
        authVersion: input.authVersion, authDisabledAt: null, emailVerifiedAt: { not: null },
        OR: [{ googleSubject: null }, { googleSubject: input.googleSubject }] },
      data: { googleSubject: input.googleSubject, authVersion: { increment: 1 } } });
      if (changed.count !== 1) throw conflict();
      return project(await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: ownershipSelect }));
    });
  }
  async confirmSubject(input: { userId: string; googleSubject: string; email: string; authVersion: number; verifyEmail: boolean }) {
    return this.mutate(async tx => {
      const changed = await tx.user.updateMany({ where: { id: input.userId, googleSubject: input.googleSubject,
        email: input.email, authVersion: input.authVersion, authDisabledAt: null, emailVerifiedAt: null },
      data: { passwordHash: null, emailVerifiedAt: input.verifyEmail ? new Date() : null, authVersion: { increment: 1 } } });
      if (changed.count !== 1) throw conflict();
      return project(await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: ownershipSelect }));
    });
  }
  async createGoogle(input: { googleSubject: string; email: string; name: string }) {
    try { return project(await this.prisma.user.create({ data: { ...input, passwordHash: null, role: 'USER', emailVerifiedAt: new Date() }, select: ownershipSelect })); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict(); throw error; }
  }
  private async mutate<T>(action: (tx: Prisma.TransactionClient) => Promise<T>) {
    try { return await this.prisma.$transaction(action); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw conflict(); throw error; }
  }
}
