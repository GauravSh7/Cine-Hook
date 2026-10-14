import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { resolveDevTarget, verifyDatabaseIdentity } from '../scripts/dev-target.js';
import { seedId } from './dev-seed-manifest.js';

const CITY_NAMES = ['New Delhi', 'Mumbai', 'Bengaluru'] as const;
const CAPACITIES = [48, 144] as const;
const SHOW_TIMES = [{ hour: 10, minute: 0 }, { hour: 14, minute: 30 }, { hour: 19, minute: 0 }] as const;
const IST_OFFSET_MINUTES = 330;
const requiredSeatTypes = ['REGULAR', 'PREMIUM', 'RECLINER'] as const;

function istDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function istSlot(now: Date, dayOffset: number, hour: number, minute: number): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * 60000);
  const localMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(localMidnight + dayOffset * 86400000 + (hour * 60 + minute - IST_OFFSET_MINUTES) * 60000);
}

async function completeMovieShows(prisma: import('../src/generated/prisma/client.js').PrismaClient, now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error('A valid development schedule clock is required.');
  const today = istDateKey(now);
  return prisma.$transaction(async tx => {
    const identity = (await tx.$queryRaw<Array<{ database: string; schema: string; port: number }>>`
      SELECT current_database() AS database, current_schema() AS schema, inet_server_port() AS port
    `)[0];
    if (!identity || identity.database !== 'cinehook_dev' || identity.schema !== 'public' || identity.port !== 5432) {
      throw new Error('Development movie schedule database identity mismatch.');
    }
    await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1667853941, 1936024932)`;

    const screens = await tx.screen.findMany({
      select: {
        id: true, name: true, capacity: true,
        seats: { select: { id: true } },
        theatre: { select: { city: { select: { name: true } } } },
        shows: { where: { status: 'SCHEDULED' }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: 1,
          select: { prices: { select: { seatType: true, pricePaise: true } } } },
      },
      orderBy: [{ id: 'asc' }],
    });
    const eligibleScreens = screens.filter(screen => CAPACITIES.includes(screen.capacity as typeof CAPACITIES[number]) &&
      CITY_NAMES.includes(screen.theatre.city.name as typeof CITY_NAMES[number]));
    if (!eligibleScreens.some(screen => screen.capacity === 48 && screen.theatre.city.name === 'New Delhi') ||
        !eligibleScreens.some(screen => screen.capacity === 48 && screen.theatre.city.name === 'Mumbai') ||
        !eligibleScreens.some(screen => screen.capacity === 48 && screen.theatre.city.name === 'Bengaluru') ||
        !eligibleScreens.some(screen => screen.capacity === 144 && screen.theatre.city.name === 'Mumbai') ||
        !eligibleScreens.some(screen => screen.capacity === 144 && screen.theatre.city.name === 'Bengaluru') ||
        eligibleScreens.some(screen => screen.seats.length !== screen.capacity)) {
      throw new Error('Existing cinema screen inventory is incomplete or inconsistent; no layouts were changed.');
    }

    // Lock only existing screens, in stable ID order, before reading schedules.
    for (const screen of eligibleScreens) await tx.$queryRaw`SELECT id FROM screens WHERE id = ${screen.id}::uuid FOR UPDATE`;

    const priceTemplates = new Map<number, Array<{ seatType: typeof requiredSeatTypes[number]; pricePaise: number }>>();
    for (const capacity of CAPACITIES) {
      const source = eligibleScreens.find(screen => screen.capacity === capacity && screen.shows[0]?.prices.length === requiredSeatTypes.length &&
        requiredSeatTypes.every(type => screen.shows[0]!.prices.some(price => price.seatType === type && price.pricePaise > 0)));
      if (!source) throw new Error(`Existing ${capacity}-seat shows have no complete seat-type price set.`);
      priceTemplates.set(capacity, source.shows[0]!.prices.map(price => ({ seatType: price.seatType, pricePaise: price.pricePaise })));
    }

    const movies = await tx.movie.findMany({
      where: { isActive: true },
      select: {
        id: true, title: true, durationMinutes: true, releaseDate: true,
        shows: { where: { status: 'SCHEDULED', startsAt: { gt: now } },
          select: { startsAt: true, screen: { select: { capacity: true, theatre: { select: { city: { select: { name: true } } } } } } },
        },
      },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    });
    const released = movies.filter(movie => movie.releaseDate.toISOString().slice(0, 10) <= today);
    const addedByCapacity = { 48: 0, 144: 0 };
    const addedByCity: Record<(typeof CITY_NAMES)[number], number> = { 'New Delhi': 0, Mumbai: 0, Bengaluru: 0 };
    let addedShows = 0;

    for (const [movieIndex, movie] of released.entries()) {
      if (!Number.isInteger(movie.durationMinutes) || movie.durationMinutes < 30 || movie.durationMinutes > 240) {
        throw new Error('An existing movie duration cannot be scheduled safely.');
      }
      for (const city of CITY_NAMES) {
        const cityShows = movie.shows.filter(show => show.screen.theatre.city.name === city);
        const dates = new Set(cityShows.map(show => istDateKey(show.startsAt)));
        const capacities = new Set(cityShows.map(show => show.screen.capacity));
        const targets: Array<{ capacity: typeof CAPACITIES[number] }> = [];
        if (!capacities.has(48)) targets.push({ capacity: 48 });
        if (city !== 'New Delhi' && !capacities.has(144)) targets.push({ capacity: 144 });
        while (dates.size + targets.length < 3) targets.push({ capacity: city === 'New Delhi' ? 48 : targets.length % 2 ? 144 : 48 });

        for (const [targetIndex, target] of targets.entries()) {
          const mustUseNewDate = dates.size < 3;
          const candidates = eligibleScreens.filter(screen => screen.capacity === target.capacity && screen.theatre.city.name === city);
          if (!candidates.length) throw new Error('No existing screen matches a required movie schedule.');
          let created = false;
          for (let dayOffset = 8; dayOffset <= 180 && !created; dayOffset++) {
            for (const time of SHOW_TIMES) {
              const startsAt = istSlot(now, dayOffset, time.hour, time.minute);
              if (startsAt <= now) continue;
              const date = istDateKey(startsAt);
              if (mustUseNewDate && dates.has(date)) continue;
              const rotation = (movieIndex + targetIndex) % candidates.length;
              for (let screenOffset = 0; screenOffset < candidates.length && !created; screenOffset++) {
                const screen = candidates[(rotation + screenOffset) % candidates.length]!;
                const endsAt = new Date(startsAt.getTime() + movie.durationMinutes * 60000);
                const id = seedId(`movie-schedule-v1:${movie.id}:${screen.id}:${startsAt.toISOString()}`);
                if (await tx.show.findUnique({ where: { id }, select: { id: true } })) continue;
                const conflicts = await tx.show.count({ where: { screenId: screen.id, status: 'SCHEDULED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
                if (conflicts) continue;
                await tx.show.create({ data: {
                  id, movieId: movie.id, screenId: screen.id, startsAt, endsAt, status: 'SCHEDULED',
                  prices: { create: priceTemplates.get(target.capacity)! },
                } });
                dates.add(date); capacities.add(screen.capacity);
                addedShows++; addedByCapacity[target.capacity]++; addedByCity[city]++;
                created = true;
              }
              if (created) break;
            }
          }
          if (!created) throw new Error('Could not find a conflict-free future time for every required movie.');
        }
      }
    }

    const verified = await tx.movie.findMany({
      where: { isActive: true },
      select: {
        releaseDate: true,
        shows: {
          where: { status: 'SCHEDULED', startsAt: { gt: now } },
          select: {
            startsAt: true,
            screen: { select: { capacity: true, theatre: { select: { city: { select: { name: true } } } } } },
          },
        },
      },
    });
    const incomplete = verified.filter(movie => movie.releaseDate.toISOString().slice(0, 10) <= today &&
      CITY_NAMES.some(city => {
        const cityShows = movie.shows.filter(show => show.screen.theatre.city.name === city);
        const dates = new Set(cityShows.map(show => istDateKey(show.startsAt)));
        return dates.size < 3 || !cityShows.some(show => show.screen.capacity === 48) ||
          (city !== 'New Delhi' && !cityShows.some(show => show.screen.capacity === 144));
      }));
    if (incomplete.length) throw new Error('Movie schedule coverage verification failed; transaction rolled back.');
    const upcomingWithShows = verified.filter(movie => movie.releaseDate.toISOString().slice(0, 10) > today && movie.shows.length > 0).length;
    if (upcomingWithShows) throw new Error('An upcoming movie already has scheduled shows; no changes were committed.');
    return { releasedMovies: released.length, upcomingMovies: movies.length - released.length, addedShows, addedByCapacity, addedByCity, allReleasedCoverageVerified: true, upcomingShowsUnchanged: true };
  }, { isolationLevel: 'ReadCommitted', maxWait: 60000, timeout: 180000 });
}

async function main() {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  if (process.env.NODE_ENV !== 'development') throw new Error('Movie show completion requires development mode.');
  const target = resolveDevTarget(process.env);
  const pool = new pg.Pool({ connectionString: target.url, max: 1, connectionTimeoutMillis: 2000 });
  try { await verifyDatabaseIdentity(pool, target); } finally { await pool.end(); }
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([import('../src/generated/prisma/client.js'), import('@prisma/adapter-pg')]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, options: '-c timezone=UTC', connectionTimeoutMillis: 2000 }) });
  try { console.log(JSON.stringify({ database: target.database, ...await completeMovieShows(prisma, new Date()) })); }
  finally { await prisma.$disconnect(); }
}
main().catch(error => {
  const message = error instanceof Error ? error.message : '';
  console.error(/^(This explicit development|Movie show completion|A valid development|No existing|Existing|No movie|Could not find|An upcoming|Development movie schedule)/.test(message)
    ? message : 'Movie schedule completion stopped safely; existing records were preserved.' );
  process.exitCode = 1;
});
