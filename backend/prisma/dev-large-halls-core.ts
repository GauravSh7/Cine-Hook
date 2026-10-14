import type { PrismaClient } from '../src/generated/prisma/client.js';
import { seedId } from './dev-seed-manifest.js';

export function largeHallLayout(): Array<{ rowName: string; seatNumber: number; seatType: 'REGULAR' | 'PREMIUM' | 'RECLINER' }> {
  return Array.from({ length: 144 }, (_, i) => ({ rowName: String.fromCharCode(65 + Math.floor(i / 12)), seatNumber: i % 12 + 1, seatType: i < 72 ? 'REGULAR' : i < 120 ? 'PREMIUM' : 'RECLINER' }));
}
export function largeHallStarts(now: Date): Date[] {
  const local = new Date(now.getTime() + 330 * 60000);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return Array.from({ length: 8 }, (_, i) => new Date(midnight + (1 + Math.floor(i / 2)) * 86400000 + (i % 2 ? 990 : 750) * 60000));
}
const idFor = (key: string) => seedId(`large-hall-v1:${key}`);
const collision = () => { throw new Error('Development large hall identity, layout or schedule collision; existing data preserved.'); };

export async function seedLargeHalls(prisma: PrismaClient, options: { expectedDatabase: string; expectedPort: number; now?: Date }) {
  if (!((options.expectedDatabase === 'cinehook_dev' && options.expectedPort === 5432) || (/^[a-zA-Z0-9_]+_test$/.test(options.expectedDatabase) && Number.isInteger(options.expectedPort) && options.expectedPort > 0 && options.expectedPort <= 65535))) throw new Error('Invalid development large hall target.');
  return prisma.$transaction(async tx => {
    const identity = (await tx.$queryRaw<Array<{ database: string; schema: string; port: number }>>`SELECT current_database() AS database,current_schema() AS schema,inet_server_port() AS port`)[0];
    if (!identity || identity.database !== options.expectedDatabase || identity.schema !== 'public' || identity.port !== options.expectedPort) throw new Error('Development large hall database identity mismatch.');
    await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1667853941, 1936024932)`;
    const movies = await Promise.all(['Deadpool & Wolverine', 'Salaar: Part 1 – Ceasefire'].map(async title => {
      const matches = await tx.movie.findMany({ where: { title, isActive: true } });
      if (matches.length !== 1 || matches[0]!.durationMinutes <= 0 || matches[0]!.durationMinutes > 240) collision();
      return matches[0]!;
    }));
    const created = { screens: 0, seats: 0, shows: 0, prices: 0 };
    const screens: Array<{ id: string; theatreId: string }> = [];
    for (const cityName of ['Mumbai', 'Bengaluru']) {
      const parents = await tx.theatre.findMany({ where: { name: `CineHook Demo ${cityName}`, city: { name: cityName, countryCode: 'IN' } } });
      if (parents.length !== 1) throw new Error('Development large hall requires exactly one existing selected theatre.');
      const parent = parents[0]!;
      const id = idFor(`screen:${cityName}`), name = 'Grand Screen 144';
      const candidates = await tx.screen.findMany({ where: { OR: [{ id }, { theatreId: parent.id, name }] }, include: { seats: true } });
      if (candidates.length > 1) collision();
      let screen = candidates[0];
      if (screen) {
        if (screen.id !== id || screen.theatreId !== parent.id || screen.name !== name || screen.capacity !== 144 || screen.seats.length !== 144) collision();
        const coordinates = new Map(screen.seats.map(s => [`${s.rowName}:${s.seatNumber}`, s.seatType]));
        if (coordinates.size !== 144 || largeHallLayout().some(s => coordinates.get(`${s.rowName}:${s.seatNumber}`) !== s.seatType)) collision();
      } else {
        screen = await tx.screen.create({ data: { id, name, capacity: 144, theatreId: parent.id, seats: { create: largeHallLayout().map(s => ({ ...s, id: idFor(`seat:${cityName}:${s.rowName}:${s.seatNumber}`) })) } }, include: { seats: true } });
        created.screens++; created.seats += 144;
      }
      screens.push({ id, theatreId: parent.id });
      await tx.$queryRaw`SELECT id FROM screens WHERE id=${id}::uuid FOR UPDATE`;
      for (const [slot, startsAt] of largeHallStarts(options.now ?? new Date()).entries()) {
        const movie = movies[slot % 2]!;
        const showId = idFor(`show:${cityName}:${startsAt.toISOString()}`);
        const endsAt = new Date(startsAt.getTime() + movie.durationMinutes * 60000);
        const existing = await tx.show.findUnique({ where: { id: showId }, include: { prices: true } });
        if (existing) {
          if (existing.screenId !== id || existing.movieId !== movie.id || existing.startsAt.getTime() !== startsAt.getTime() || existing.endsAt.getTime() !== endsAt.getTime() || existing.prices.length !== 3 || !['REGULAR','PREMIUM','RECLINER'].every(type => existing.prices.some(p => p.seatType === type && p.pricePaise > 0))) collision();
          continue;
        }
        const whereParent = { screen: { theatreId: parent.id, id: { not: id } }, status: 'SCHEDULED' as const };
        const source = await tx.show.findFirst({ where: { ...whereParent, movieId: movie.id }, include: { prices: true }, orderBy: [{ startsAt: 'desc' }, { id: 'asc' }] }) ?? await tx.show.findFirst({ where: whereParent, include: { prices: true }, orderBy: [{ startsAt: 'desc' }, { id: 'asc' }] });
        if (!source || source.prices.length !== 3 || !['REGULAR','PREMIUM','RECLINER'].every(type => source.prices.some(p => p.seatType === type && p.pricePaise > 0))) throw new Error('Development large hall requires existing parent show prices for all seat types.');
        if (await tx.show.count({ where: { screenId: id, OR: [{ startsAt }, { status: 'SCHEDULED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }] } })) collision();
        await tx.show.create({ data: { id: showId, movieId: movie.id, screenId: id, startsAt, endsAt, status: 'SCHEDULED', prices: { create: source.prices.map(p => ({ seatType: p.seatType, pricePaise: p.pricePaise })) } } });
        created.shows++; created.prices += 3;
      }
    }
    return { created, screens, movies: movies.map(m => ({ id: m.id, title: m.title })) };
  }, { timeout: 60000 });
}
