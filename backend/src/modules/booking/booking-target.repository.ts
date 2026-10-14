import type { BookingKind, PrismaClient } from '../../generated/prisma/client.js';
import type { Page } from '../catalog/catalog.types.js';

export interface BookingTargets {
  findTarget(id: string, owner?: string): Promise<BookingKind | null>;
  referencesByUser(owner: string, page: Page): Promise<{ id: string }[]>;
}

// Immutable target identity and mixed-history pagination belong to persistence,
// independently of the movie/event repositories' fulfillment state transitions.
export class BookingTargetRepository implements BookingTargets {
  constructor(private readonly prisma: PrismaClient) {}
  async findTarget(id: string, owner?: string) {
    const target = await this.prisma.booking.findUnique({ where: { id }, select: { bookingKind: true, userId: true } });
    if (!target || (owner && target.userId !== owner)) return null;
    return target.bookingKind;
  }
  referencesByUser(owner: string, page: Page) {
    return this.prisma.booking.findMany({ where: { userId: owner }, select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page.page - 1) * page.limit, take: page.limit });
  }
}
