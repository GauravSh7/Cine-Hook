import type { PrismaClient } from '../../generated/prisma/client.js';
import { WishlistRepository } from './wishlist.repository.js';
import { WishlistService } from './wishlist.service.js';
export function createWishlist(prisma: PrismaClient) { return new WishlistService(new WishlistRepository(prisma)); }
