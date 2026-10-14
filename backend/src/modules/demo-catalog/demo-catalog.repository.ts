import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import type { DemoListingKind } from '../../generated/prisma/client.js';
import type { DemoStoreQuery, DemoStore } from './demo-catalog.types.js';
export class DemoCatalogRepository implements DemoStore {
  constructor(private readonly prisma: PrismaClient) {}
  list(query: DemoStoreQuery) {
    const where: Prisma.DemoListingWhereInput = { kind: query.kind, isActive: true };
    if (query.category) where.category = query.category;
    if (query.cityName) where.cityName = { equals: query.cityName, mode: 'insensitive' };
    if (query.search) where.title = { contains: query.search.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' };
    return this.prisma.demoListing.findMany({ where, orderBy: [{ title: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit });
  }
  findActive(kind: DemoListingKind, id: string) {
    return this.prisma.demoListing.findFirst({ where: { id, kind, isActive: true } });
  }
  async findCityName(id: string) {
    return (await this.prisma.city.findUnique({ where: { id }, select: { name: true } }))?.name ?? null;
  }
}
