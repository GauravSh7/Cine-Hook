import type { PrismaClient } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { toPublicUser } from '../auth/auth.types.js';
import { publicSelect } from '../auth/user.repository.js';
import type { AccountStore, ProfilePatch } from './account.types.js';
export class AccountRepository implements AccountStore {
  constructor(private readonly prisma: PrismaClient) {}
  async updateProfile(userId: string, patch: ProfilePatch) {
    return toPublicUser(await this.prisma.user.update({ where: { id: userId }, data: patch, select: publicSelect }));
  }
  async getAvatarPublicId(userId: string) {
    return (await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarPublicId: true } }))?.avatarPublicId ?? null;
  }
  async swapAvatar(userId: string, avatar: { url: string; publicId: string }) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: userId }, select: { avatarPublicId: true } });
      if (!current) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
      const user = await tx.user.update({ where: { id: userId }, data: { avatarUrl: avatar.url, avatarPublicId: avatar.publicId }, select: publicSelect });
      return { user: toPublicUser(user), oldPublicId: current.avatarPublicId };
    });
  }
}
