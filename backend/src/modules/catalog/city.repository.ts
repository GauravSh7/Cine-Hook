import type { PrismaClient } from '../../generated/prisma/client.js';
import type { CityInput, CityQuery, CityStore } from './catalog.types.js';
import { databaseWrite } from './database-write.js';

export class CityRepository implements CityStore {
  constructor(private readonly prisma: PrismaClient) {}
  list(query: CityQuery) {
    const search = query.search?.replace(/[\\%_]/g, value => `\\${value}`);
    return this.prisma.city.findMany({ where: { countryCode: 'IN', ...(query.state ? { state: { equals: query.state, mode: 'insensitive' } } : {}), ...(search ? { OR: [
      { name: { contains: search, mode: 'insensitive' } }, { state: { contains: search, mode: 'insensitive' } },
    ] } : {}) }, orderBy: [{ theatres: { _count: 'desc' } }, { name: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit });
  }
  findById(id: string) { return this.prisma.city.findUnique({ where: { id } }); }
  create(input: CityInput) { return databaseWrite(() => this.prisma.city.create({ data: input }), 'City'); }
}
