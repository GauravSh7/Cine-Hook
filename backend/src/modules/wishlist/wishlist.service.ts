import type { Page } from '../catalog/catalog.types.js';
import type { WishlistStore } from './wishlist.types.js';
import { publicMovie } from '../catalog/public-movie.js';
export class WishlistService {
  constructor(private readonly store: WishlistStore) {}
  async list(userId: string, page: Page) {
    const rows = await this.store.list(userId, page);
    return { items: rows.map(({ movie, createdAt }) => ({ createdAt, movie: publicMovie(movie) })), ...page };
  }
  async status(userId: string, movieId: string) { return { saved: await this.store.isSaved(userId, movieId) }; }
  async save(userId: string, movieId: string) { await this.store.save(userId, movieId); return { saved: true }; }
  async remove(userId: string, movieId: string) { await this.store.remove(userId, movieId); return { saved: false }; }
}
