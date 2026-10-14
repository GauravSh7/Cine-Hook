import { expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { AccountRepository } from '../src/modules/account/account.repository.js';
import { WishlistRepository } from '../src/modules/wishlist/wishlist.repository.js';
import { UserRepository } from '../src/modules/auth/user.repository.js';

const user = { id: '00000000-0000-4000-8000-000000000001', name: 'Viewer', email: 'viewer@example.com', role: 'USER' as const,
  dateOfBirth: new Date('2000-02-29'), phone: '+919876543210', avatarUrl: 'https://res.cloudinary.com/demo/image/upload/x.webp',
  createdAt: new Date(), updatedAt: new Date() };
it('selects only public profile fields and serializes database DATE values in auth reads and creation', async () => {
  const calls: unknown[] = [];
  const prisma = { user: { findUnique: async (q: unknown) => { calls.push(q); return user; }, create: async (q: unknown) => { calls.push(q); return user; } } } as unknown as PrismaClient;
  const repository = new UserRepository(prisma);
  expect(await repository.findById(user.id)).toMatchObject({ dateOfBirth: '2000-02-29', phone: '+919876543210' });
  await repository.create({ name: user.name, email: user.email, passwordHash: 'hash' });
  expect(calls).toEqual([
    { where: { id: user.id }, select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true, dateOfBirth: true, phone: true, avatarUrl: true } },
    { data: { name: user.name, email: user.email, passwordHash: 'hash', role: 'USER' }, select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true, dateOfBirth: true, phone: true, avatarUrl: true } },
  ]);
});
it('locks an account before reading the old avatar and returns only the replaced asset for cleanup', async () => {
  const events: string[] = []; let update: unknown;
  const tx = { $queryRaw: async (strings: TemplateStringsArray, id: string) => { expect(strings.join('?')).toContain('FOR UPDATE'); expect(id).toBe(user.id); events.push('lock'); },
    user: { findUnique: async () => { events.push('read'); return { avatarPublicId: 'old/id' }; },
      update: async (q: unknown) => { events.push('write'); update = q; return { ...user, avatarUrl: 'https://res.cloudinary.com/demo/image/upload/new.webp' }; } } };
  const prisma = { $transaction: async (fn: (client: typeof tx) => unknown) => await fn(tx) } as unknown as PrismaClient;
  const result = await new AccountRepository(prisma).swapAvatar(user.id, { publicId: 'new/id', url: 'https://res.cloudinary.com/demo/image/upload/new.webp' });
  expect(events).toEqual(['lock', 'read', 'write']); expect(result.oldPublicId).toBe('old/id');
  expect(result.user).not.toHaveProperty('avatarPublicId'); expect(result.user.dateOfBirth).toBe('2000-02-29');
  expect(update).toMatchObject({ where: { id: user.id }, data: { avatarUrl: 'https://res.cloudinary.com/demo/image/upload/new.webp', avatarPublicId: 'new/id' } });
});
it('emits owner-scoped stable wishlist ordering and explicit public movie selection including inactive history', async () => {
  let query: unknown;
  const prisma = { movieWishlist: { findMany: async (q: unknown) => { query = q; return []; } } } as unknown as PrismaClient;
  await new WishlistRepository(prisma).list(user.id, { page: 3, limit: 5 });
  expect(query).toEqual({ where: { userId: user.id }, orderBy: [{ createdAt: 'desc' }, { movieId: 'asc' }], skip: 10, take: 5,
    select: { createdAt: true, movie: { select: { id: true, title: true, description: true, durationMinutes: true, releaseDate: true, language: true,
      genres: true, posterUrl: true, isActive: true, createdAt: true, updatedAt: true,
      backdropUrl: true, collections: true, metadataSourceUrl: true, artworkKind: true, artworkAttribution: true, artworkSourceUrl: true,
      descriptionHindi: true, trailerVideoId: true, trailerSourceUrl: true, trailerVerifiedAt: true,
      ratingValue: true, ratingVoteCount: true, ratingSource: true, ratingSourceUrl: true, ratingFetchedAt: true,
      shows: { where: { status: 'SCHEDULED', startsAt: { gt: expect.any(Date) }, screen: { theatre: { cityId: undefined } } },
        orderBy: { startsAt: 'asc' }, select: { id: true, startsAt: true }, take: 1 } } } } });
});
it('locks a movie against disable before a database-native duplicate-safe insert', async () => {
  const events: string[] = [];
  const tx = { $queryRaw: async (strings: TemplateStringsArray, id: string) => { expect(strings.join('?')).toContain('FOR SHARE'); expect(id).toBe('movie-id'); events.push('lock'); return [{ id, is_active: true }]; },
    $executeRaw: async (strings: TemplateStringsArray, userId: string, movieId: string) => {
      expect(strings.join('?')).toContain('ON CONFLICT ("user_id", "movie_id") DO NOTHING');
      expect(userId).toBe(user.id); expect(movieId).toBe('movie-id'); events.push('insert');
    }, movieWishlist: { upsert: async () => { events.push('emulated-upsert'); } } };
  const prisma = { $transaction: async (fn: (client: typeof tx) => unknown) => await fn(tx) } as unknown as PrismaClient;
  await new WishlistRepository(prisma).save(user.id, 'movie-id');
  expect(events).toEqual(['lock', 'insert']);
});
it.each([{ rows: [] }, { rows: [{ id: 'movie-id', is_active: false }] }])('never saves missing or disabled locked movies', async ({ rows }) => {
  let inserted = false;
  const tx = { $queryRaw: async () => rows, movieWishlist: { upsert: async () => { inserted = true; } } };
  const prisma = { $transaction: async (fn: (client: typeof tx) => unknown) => await fn(tx) } as unknown as PrismaClient;
  await expect(new WishlistRepository(prisma).save(user.id, 'movie-id')).rejects.toMatchObject({ status: 404 });
  expect(inserted).toBe(false);
});
