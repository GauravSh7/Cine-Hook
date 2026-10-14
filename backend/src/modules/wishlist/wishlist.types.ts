import type { Movie } from '../../generated/prisma/client.js';
import type { Page } from '../catalog/catalog.types.js';
export interface WishlistItem { movie: Movie; createdAt: Date }
export interface WishlistStore {
  list(userId: string, page: Page): Promise<WishlistItem[]>;
  isSaved(userId: string, movieId: string): Promise<boolean>;
  save(userId: string, movieId: string): Promise<void>;
  remove(userId: string, movieId: string): Promise<void>;
}
