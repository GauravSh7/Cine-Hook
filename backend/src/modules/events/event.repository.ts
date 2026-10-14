import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import type { EventStore, EventQuery, EventSessionQuery } from './event.types.js';

const people = { performers: { orderBy: { name: 'asc' as const } }, participants: { orderBy: { name: 'asc' as const } } } as const;
const prices = { orderBy: { ticketTier: 'asc' as const } } as const;
const venueSummary = { include: { city: true } } as const;
const sessionDetail = { event: { include: people }, prices, venue: { include: { city: true, sections: {
  orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }], include: { seats: {
    orderBy: [{ rowName: 'asc' as const }, { seatNumber: 'asc' as const }, { id: 'asc' as const }],
  } },
} } } } satisfies Prisma.EventSessionInclude;
const upcoming = (asOf: Date, cityId?: string): Prisma.EventSessionWhereInput => ({ status: 'SCHEDULED', startsAt: { gt: asOf }, venue: { cityId } });
const eventDetail = (asOf: Date, cityId?: string) => ({ ...people, sessions: {
  where: upcoming(asOf, cityId), include: { venue: venueSummary, prices }, orderBy: [{ startsAt: 'asc' as const }, { id: 'asc' as const }],
} });

export class EventRepository implements EventStore {
  constructor(private readonly prisma: PrismaClient) {}
  async cityExists(id: string) { return (await this.prisma.city.findUnique({ where: { id }, select: { id: true } })) !== null; }
  list(query: EventQuery, asOf: Date) {
    return this.prisma.event.findMany({ where: { isActive: true, kind: query.kind,
      ...(query.search ? { title: { contains: query.search.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' } } : {}),
      ...(query.cityId ? { sessions: { some: upcoming(asOf, query.cityId) } } : {}),
    }, include: eventDetail(asOf, query.cityId), orderBy: [{ title: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit });
  }
  findById(id: string, asOf: Date) { return this.prisma.event.findFirst({ where: { id, isActive: true }, include: eventDetail(asOf) }); }
  listSessions(query: EventSessionQuery, asOf: Date) {
    return this.prisma.eventSession.findMany({ where: { ...upcoming(asOf, query.cityId), eventId: query.eventId, event: { isActive: true } },
      include: sessionDetail, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit });
  }
  findSessionById(id: string, asOf: Date) {
    return this.prisma.eventSession.findFirst({ where: { id, ...upcoming(asOf), event: { isActive: true } }, include: sessionDetail });
  }
}
