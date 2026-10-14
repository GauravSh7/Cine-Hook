import type { PrismaClient, EventTicketTier } from '../src/generated/prisma/client.js';
import { PREVIOUS_EVENT_MEDIA } from './catalogue-media.js';
import { EVENT_SAMPLES, eventSeedId, eventSessionSeedId, eventStarts, type EventSample } from './event-seed-manifest.js';
export type EventSeedOptions = { expectedDatabase: string; expectedPort: number; now?: Date };
type LayoutSection = { id: string; code: string; position: string; sortOrder: number;
  seats: Array<{ id: string; rowName: string; seatNumber: number; ticketTier: EventTicketTier }> };
function collision(entity: string): never { throw new Error(`Event seed ${entity} identity collision; all changes rolled back.`); }
export function assertEventLayout(sample: EventSample, capacity: number, sections: LayoutSection[]): void {
  if (capacity !== sample.capacity || sections.length !== sample.sections.length) throw new Error('Event seed physical layout collision.');
  for (const expected of sample.sections) {
    const section = sections.find(s => s.code === expected.code);
    if (!section || section.id !== eventSeedId(`section:${sample.key}:${expected.code}`) || section.position !== expected.position ||
      section.sortOrder !== expected.sortOrder || section.seats.length !== expected.seats.length) throw new Error('Event seed physical layout collision.');
    const seats = new Map(section.seats.map(seat => [`${seat.rowName}:${seat.seatNumber}`, seat]));
    if (seats.size !== expected.seats.length) throw new Error('Event seed physical layout collision.');
    for (const seat of expected.seats) {
      const actual = seats.get(`${seat.rowName}:${seat.seatNumber}`);
      if (!actual || actual.id !== eventSeedId(`seat:${sample.key}:${expected.code}:${seat.rowName}:${seat.seatNumber}`) || actual.ticketTier !== seat.ticketTier)
        throw new Error('Event seed physical layout collision.');
    }
  }
}

/** Explicit caller only: insert missing identities/dates; refresh exact old seed artwork only. */
export async function seedEvents(prisma: PrismaClient, options: EventSeedOptions) {
  const isTest = /^cinehook_event_seed_[a-z0-9_]+_test$/.test(options.expectedDatabase) && options.expectedPort === 55438;
  if (!((options.expectedDatabase === 'cinehook_dev' && options.expectedPort === 5432) || isTest)) throw new Error('Invalid event seed target.');
  const starts = eventStarts(options.now ?? new Date());
  return prisma.$transaction(async tx => {
    const actual = (await tx.$queryRaw<Array<{ database: string; schema: string; port: number; address: string; role: string }>>`
      SELECT current_database() AS database,current_schema() AS schema,inet_server_port() AS port,host(inet_server_addr()) AS address,current_user AS role
    `)[0];
    if (!actual || actual.database !== options.expectedDatabase || actual.schema !== 'public' || actual.port !== options.expectedPort ||
      !['127.0.0.1', '::1'].includes(actual.address) || (isTest && actual.role !== 'cinehook_verify')) throw new Error('Event seed database identity mismatch.');
    // PrismaPg Date parameters omit the offset. Protect every caller, including non-UTC pools.
    // Transaction local: after target verification, before the first Date parameter, no pool leak.
    await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
    // Explicit seed serialization uses the existing 120s transaction budget, not the app's 2s query default.
    // LOCAL restores the caller's normal connection timeout at commit/rollback; no global setting changes.
    await tx.$executeRaw`SET LOCAL statement_timeout = '120s'`;
    // Same development-content lock as the other explicit seed commands; cross-process and transaction scoped.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1667853941, 1936024932)`;
    const created = { events: 0, performers: 0, participants: 0, venues: 0, sections: 0, seats: 0, sessions: 0, prices: 0 };
    const cities = new Map<string, string>();
    for (const sample of EVENT_SAMPLES) {
      if (cities.has(sample.city.name)) continue;
      const matches = await tx.city.findMany({ where: sample.city });
      if (matches.length !== 1) throw new Error(`Event seed requires one existing supported city: ${sample.city.name}.`);
      cities.set(sample.city.name, matches[0]!.id);
    }
    for (const sample of EVENT_SAMPLES) {
      const id = eventSeedId(`event:${sample.key}`), cityId = cities.get(sample.city.name)!;
      const candidates = await tx.event.findMany({ where: { OR: [{ id }, { slug: sample.slug }] } });
      if (candidates.length && (candidates.length !== 1 || candidates[0]!.id !== id || candidates[0]!.slug !== sample.slug ||
        candidates[0]!.kind !== sample.kind || candidates[0]!.sport !== sample.sport)) collision('event');
      const event = candidates[0] ?? await tx.event.create({ data: { id, slug: sample.slug, title: sample.title, description: sample.description,
        kind: sample.kind, sport: sample.sport, durationMinutes: sample.durationMinutes, imageUrl: sample.imageUrl, imageAttribution: sample.imageAttribution,
        isActive: true, isSample: true, performers: { create: sample.performers }, participants: { create: sample.participants } } });
      if (!candidates.length) { created.events++; created.performers += sample.performers.length; created.participants += sample.participants.length; }
        else await tx.event.updateMany({where:{id,imageUrl:{in:[`/demo-category-art/${sample.kind.toLowerCase()}.svg`,...(PREVIOUS_EVENT_MEDIA[sample.key]?[PREVIOUS_EVENT_MEDIA[sample.key]!]:[])]}},data:{imageUrl:sample.imageUrl,imageAttribution:sample.imageAttribution}});

      const venueId = eventSeedId(`venue:${sample.key}`);
      const venues = await tx.eventVenue.findMany({ where: { OR: [{ id: venueId }, { cityId, name: sample.venueName }] }, include: { sections: { include: { seats: true } } } });
      if (venues.length && (venues.length !== 1 || venues[0]!.id !== venueId || venues[0]!.cityId !== cityId ||
        venues[0]!.name.toLowerCase() !== sample.venueName.toLowerCase() || venues[0]!.kind !== sample.venueKind)) collision('venue');
      if (venues[0]) assertEventLayout(sample, venues[0].capacity, venues[0].sections);
      else {
        await tx.eventVenue.create({ data: { id: venueId, cityId, name: sample.venueName, address: sample.address, kind: sample.venueKind, capacity: sample.capacity,
          sections: { create: sample.sections.map(section => ({ id: eventSeedId(`section:${sample.key}:${section.code}`), code: section.code,
            name: section.name, position: section.position, sortOrder: section.sortOrder,
            seats: { create: section.seats.map(seat => ({ ...seat, id: eventSeedId(`seat:${sample.key}:${section.code}:${seat.rowName}:${seat.seatNumber}`) })) } })) } } });
        created.venues++; created.sections += sample.sections.length; created.seats += sample.capacity;
      }
      // Retain user-deactivated/reclassified sample records without new advertised dates.
      if (!event.isActive || !event.isSample) continue;
      for (const startsAt of starts) {
        const sessionId = eventSessionSeedId(sample.key, startsAt);
        const sessions = await tx.eventSession.findMany({ where: { OR: [{ id: sessionId }, { venueId, startsAt }] } });
        if (sessions.length && (sessions.length !== 1 || sessions[0]!.id !== sessionId || sessions[0]!.eventId !== id || sessions[0]!.venueId !== venueId ||
          sessions[0]!.startsAt.getTime() !== startsAt.getTime())) collision('session');
        if (sessions.length) continue; // Includes cancelled sessions, edited prices and old duration snapshots.
        await tx.eventSession.create({ data: { id: sessionId, eventId: id, venueId, startsAt, prices: { create: sample.prices } } });
        created.sessions++; created.prices += sample.prices.length;
      }
    }
    return { created };
  }, { isolationLevel: 'ReadCommitted', maxWait: 60000, timeout: 120000 });
}
