import type { User } from '../../generated/prisma/client.js';

export type UserRole = 'USER' | 'ADMIN';
export type StoredUser = Omit<Pick<User, 'id' | 'name' | 'email' | 'role' | 'passwordHash' | 'createdAt' | 'updatedAt'>, 'passwordHash'> & {
  passwordHash: string | null; googleSubject?: string | null;
  dateOfBirth?: Date | null; phone?: string | null; avatarUrl?: string | null; avatarPublicId?: string | null;
};
export interface PublicUser {
  id: string; name: string; email: string; role: UserRole; createdAt: Date; updatedAt: Date;
  dateOfBirth?: string | null; phone?: string | null; avatarUrl?: string | null;
}
export function toPublicUser(user: Omit<PublicUser, 'dateOfBirth'> & { dateOfBirth?: Date | string | null }): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role,
    createdAt: user.createdAt, updatedAt: user.updatedAt,
    dateOfBirth: user.dateOfBirth instanceof Date ? user.dateOfBirth.toISOString().slice(0, 10) : user.dateOfBirth ?? null,
    phone: user.phone ?? null, avatarUrl: user.avatarUrl ?? null };
}
export interface UserStore {
  create(input: { name: string; email: string; passwordHash: string }): Promise<PublicUser>;
  findByEmail(email: string): Promise<StoredUser | null>;
  findById(id: string): Promise<PublicUser | null>;
}
export interface Identity { userId: string; role: UserRole }
export interface RegisterInput { name: string; email: string; password: string }
export interface LoginInput { email: string; password: string }
