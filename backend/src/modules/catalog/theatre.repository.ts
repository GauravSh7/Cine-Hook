import type { PrismaClient } from '../../generated/prisma/client.js';
import type { TheatreInput, TheatreQuery, TheatreStore } from './catalog.types.js';
import { databaseWrite } from './database-write.js';
import { schedulingWrite } from '../shows/scheduling-write.js';

export class TheatreRepository implements TheatreStore {
  constructor(private readonly prisma: PrismaClient) {}
  list(query: TheatreQuery) { return this.prisma.theatre.findMany({ where: query.cityId ? { cityId: query.cityId } : {},
    orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit }); }
  findById(id: string) { return this.prisma.theatre.findUnique({ where: { id }, include: { city: true, screens: { orderBy: [{ name: 'asc' }, { id: 'asc' }] } } }); }
  create(input: TheatreInput) { return databaseWrite(() => this.prisma.theatre.create({ data: input }), 'Theatre'); }
  update(id: string, input: Partial<TheatreInput>) { return schedulingWrite(() => this.prisma.theatre.update({ where: { id }, data: input })); }
}
