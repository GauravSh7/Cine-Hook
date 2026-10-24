import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import type { PublicUser, StoredUser, UserStore } from './auth.types.js';
import { toPublicUser } from './auth.types.js';

export const publicSelect = {
  id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true,
  dateOfBirth: true, phone: true, avatarUrl: true,
} satisfies Prisma.UserSelect;

export class UserRepository implements UserStore {
  constructor(private readonly prisma: PrismaClient) {}

  async revokeSessions(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { authVersion: { increment: 1 } }, select: { id: true } });
  }

  async create(input: { name: string; email: string; passwordHash: string }): Promise<PublicUser> {
    try {
      return toPublicUser(await this.prisma.user.create({ data: { ...input, role: 'USER' }, select: publicSelect }));
    } catch (error) {
      // The unique DB constraint is authoritative, including concurrent requests.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'EMAIL_EXISTS', 'Email is already registered.');
      }
      throw error;
    }
  }

  async findByEmail(email: string): Promise<StoredUser | null> {
    // Credentials are read only for login. Hash never reaches the controller.
    return this.prisma.user.findUnique({ where: { email }, select: { ...publicSelect, passwordHash: true,
      googleSubject: true, authVersion: true, emailVerifiedAt: true, authDisabledAt: true } });
  }

  async findById(id: string): Promise<PublicUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: publicSelect });
    return user ? toPublicUser(user) : null;
  }
}
