import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import type { Page } from '../catalog/catalog.types.js';
import type { WishlistStore } from './wishlist.types.js';
import { movieMetadataSelect, upcomingShowInclude } from '../catalog/public-movie.js';
const movieSelect = { id: true, title: true, description: true, durationMinutes: true, releaseDate: true,
  language: true, genres: true, posterUrl: true, isActive: true, createdAt: true, updatedAt: true, ...movieMetadataSelect } satisfies Prisma.MovieSelect;
export class WishlistRepository implements WishlistStore {
  constructor(private readonly prisma: PrismaClient) {}
  async list(userId: string, page: Page) {
    return this.prisma.movieWishlist.findMany({ where: { userId }, select: { createdAt: true, movie: { select: { ...movieSelect, ...upcomingShowInclude() } } },
      orderBy: [{ createdAt: 'desc' }, { movieId: 'asc' }], skip: (page.page - 1) * page.limit, take: page.limit });
  }
  async isSaved(userId: string, movieId: string) {
    return !!await this.prisma.movieWishlist.findUnique({ where: { userId_movieId: { userId, movieId } }, select: { movieId: true } });
  }
  async save(userId: string, movieId: string) {
    await this.prisma.$transaction(async tx => {
      // PostgreSQL UPDATE (including catalogue disable) conflicts with FOR SHARE.
      // An inactive/deleted movie cannot slip between validation and insertion.
      const rows = await tx.$queryRaw<{ id: string; is_active: boolean }[]>`SELECT id, is_active FROM movies WHERE id = ${movieId}::uuid FOR SHARE`;
      if (!rows[0]?.is_active) throw new AppError(404, 'NOT_FOUND', 'Active movie not found.');
      await tx.$executeRaw`INSERT INTO movie_wishlists (user_id, movie_id) VALUES (${userId}::uuid, ${movieId}::uuid)
        ON CONFLICT ("user_id", "movie_id") DO NOTHING`;
    });
  }
  async remove(userId: string, movieId: string) {
    await this.prisma.movieWishlist.deleteMany({ where: { userId, movieId } });
  }
}
