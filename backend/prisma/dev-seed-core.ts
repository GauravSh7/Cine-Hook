import bcrypt from 'bcrypt';
import type { PrismaClient, Prisma } from '../src/generated/prisma/client.js';
import { DEV_ADMIN, FILMS, VENUES, SEAT_LAYOUT, SEAT_PRICES, futureShowStarts, morningFilmIndex, seedId, validateAdminPassword } from './dev-seed-manifest.js';

type LayoutSeat = { rowName: string; seatNumber: number; seatType: string };
export type SeedOptions = { expectedDatabase: string; expectedPort: number; now?: Date; password?: string };
export type SeedResult = { created: { users: number; movies: number; cities: number; theatres: number; screens: number; seats: number; shows: number; prices: number } };

export function assertLayoutCompatible(capacity: number, seats: ReadonlyArray<LayoutSeat>): void {
  const actual = new Map(seats.map(seat => [`${seat.rowName}:${seat.seatNumber}`, seat.seatType]));
  if (capacity !== 48 || seats.length !== 48 || actual.size !== 48 || SEAT_LAYOUT.some(seat => actual.get(`${seat.rowName}:${seat.seatNumber}`) !== seat.seatType)) {
    throw new Error('Existing development screen layout is incompatible; no layout was changed.');
  }
}

function collision(kind: string): never { throw new Error(`Development ${kind} identity collision; no existing data will be changed.`); }
function sameText(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase(); }
function sameDate(left: Date, right: string): boolean { return left.toISOString().slice(0,10) === right; }

/**
 * Explicit development tool, never imported by the application runtime.
 * The caller supplies a client and expected server identity. Test harnesses use
 * an explicitly isolated *_test identity; the public CLI never accepts that path.
 * All additions serialize under one advisory lock and commit as a single unit.
 */
export async function seedDevelopment(prisma: PrismaClient, options: SeedOptions): Promise<SeedResult> {
  if (!((options.expectedDatabase === 'cinehook_dev' && options.expectedPort === 5432) ||
        (/^[A-Za-z0-9_]+_test$/.test(options.expectedDatabase) && Number.isInteger(options.expectedPort) && options.expectedPort > 0 && options.expectedPort <= 65535))) {
    throw new Error('Invalid development seed target.');
  }
  const starts = futureShowStarts(options.now ?? new Date());
  const result: SeedResult = { created: { users: 0, movies: 0, cities: 0, theatres: 0, screens: 0, seats: 0, shows: 0, prices: 0 } };
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const identity = (await tx.$queryRaw<Array<{ database: string; schema: string; port: number }>>`
      SELECT current_database() AS database, current_schema() AS schema, inet_server_port() AS port
    `)[0];
    if (!identity || identity.database !== options.expectedDatabase || identity.schema !== 'public' || identity.port !== options.expectedPort) throw new Error('Development seed database identity mismatch.');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1667853941, 1936024932)`;

    const admins = await tx.user.findMany({ where: { OR: [{ id: DEV_ADMIN.id }, { email: DEV_ADMIN.email }] } });
    if (admins.length) {
      if (admins.length !== 1 || admins[0]!.id !== DEV_ADMIN.id || admins[0]!.email !== DEV_ADMIN.email || admins[0]!.role !== 'ADMIN') collision('admin');
    } else {
      if (!options.password) throw new Error('First development admin creation requires a locally supplied DEV_ADMIN_PASSWORD or hidden prompt.');
      validateAdminPassword(options.password);
      const passwordHash = await bcrypt.hash(options.password, 12);
      await tx.user.create({ data: { ...DEV_ADMIN, role: 'ADMIN', passwordHash } }); result.created.users++;
    }

    const movies: Array<{ id: string; durationMinutes: number }> = [];
    for (const film of FILMS) {
      const id = seedId(`movie:${film.key}`);
      const candidates = await tx.movie.findMany({ where: { OR: [{ id }, { title: film.title, language: film.language, releaseDate: new Date(`${film.releaseDate}T00:00:00Z`) }] } });
      if (candidates.length > 1) collision('movie');
      let movie = candidates[0];
      if (movie && (movie.title !== film.title || movie.language !== film.language || !sameDate(movie.releaseDate, film.releaseDate) || !movie.isActive)) collision('movie');
      if (!movie) {
        movie = await tx.movie.create({ data: { id, title: film.title, description: film.description, durationMinutes: film.durationMinutes, releaseDate: new Date(`${film.releaseDate}T00:00:00Z`), language: film.language, genres: [...film.genres], posterUrl: film.posterUrl, backdropUrl: film.backdropUrl,
          collections: film.collections, metadataSourceUrl: film.sourceUrl, artworkKind: film.artworkKind, artworkAttribution: film.artworkAttribution,
          artworkSourceUrl: null, ratingValue: null, ratingVoteCount: null, ratingSource: null, ratingSourceUrl: null, ratingFetchedAt: null, isActive: true } });
        result.created.movies++;
      } else if (movie.id === id && movie.posterUrl === film.previousPosterUrl) {
        // Upgrade only the exact generated seed artwork. User-provided movie media is never overwritten.
        await tx.movie.updateMany({ where: { id, posterUrl: film.previousPosterUrl }, data: { posterUrl: film.posterUrl, backdropUrl: film.backdropUrl,
          collections: film.collections, metadataSourceUrl: film.sourceUrl, artworkKind: null, artworkAttribution: null, artworkSourceUrl: null } });
      }
      movies.push(movie);
    }

    for (const [venueIndex, venue] of VENUES.entries()) {
      const cityId = seedId(`city:${venue.key}`);
      const cityCandidates = await tx.city.findMany({ where: { OR: [{ id: cityId }, { countryCode: venue.countryCode, state: venue.state, name: venue.name }] } });
      if (cityCandidates.length > 1) collision('city');
      let city = cityCandidates[0];
      if (city && (city.countryCode !== venue.countryCode || !sameText(city.state, venue.state) || !sameText(city.name, venue.name))) collision('city');
      if (!city) { city = await tx.city.create({ data: { id: cityId, name: venue.name, state: venue.state, countryCode: venue.countryCode } }); result.created.cities++; }

      const theatreId = seedId(`theatre:${venue.key}`);
      const theatreCandidates = await tx.theatre.findMany({ where: { OR: [{ id: theatreId }, { cityId: city.id, name: venue.theatreName }] } });
      if (theatreCandidates.length > 1) collision('theatre');
      let theatre = theatreCandidates[0];
      if (theatre && (theatre.cityId !== city.id || !sameText(theatre.name, venue.theatreName))) collision('theatre');
      if (!theatre) { theatre = await tx.theatre.create({ data: { id: theatreId, name: venue.theatreName, cityId: city.id, address: venue.address } }); result.created.theatres++; }

      for (let screenIndex = 0; screenIndex < 2; screenIndex++) {
        const screenKey = `${venue.key}:${screenIndex + 1}`, id = seedId(`screen:${screenKey}`), name = `Demo Screen ${screenIndex + 1}`;
        const screenCandidates = await tx.screen.findMany({ where: { OR: [{ id }, { theatreId: theatre.id, name }] } });
        if (screenCandidates.length > 1) collision('screen');
        let screen = screenCandidates[0];
        if (screen && (screen.theatreId !== theatre.id || !sameText(screen.name, name) || screen.capacity !== 48)) throw new Error('Development screen identity or layout capacity is incompatible.');
        if (!screen) { screen = await tx.screen.create({ data: { id, name, theatreId: theatre.id, capacity: 48 } }); result.created.screens++; }
        // Same serialization boundary used by schema layout/scheduling triggers.
        await tx.$queryRaw`SELECT id FROM screens WHERE id = ${screen.id}::uuid FOR UPDATE`;
        const seats = await tx.seat.findMany({ where: { screenId: screen.id } });
        const plannedSeats = SEAT_LAYOUT.map(seat => ({ ...seat, screenId: screen.id, id: seedId(`seat:${screenKey}:${seat.rowName}:${seat.seatNumber}`) }));
        const reservedSeats = await tx.seat.findMany({ where: { id: { in: plannedSeats.map(seat => seat.id) } } });
        for (const existing of reservedSeats) {
          const expected = plannedSeats.find(seat => seat.id === existing.id)!;
          if (existing.screenId !== expected.screenId || existing.rowName !== expected.rowName || existing.seatNumber !== expected.seatNumber || existing.seatType !== expected.seatType) collision('seat');
        }
        if (seats.length === 0) {
          if (await tx.show.count({ where: { screenId: screen.id } })) throw new Error('Existing scheduled screen has no compatible layout; seat inserts are prohibited.');
          await tx.seat.createMany({ data: plannedSeats }); result.created.seats += 48;
        } else assertLayoutCompatible(screen.capacity, seats); // Never upsert/reinsert seats after scheduling.

        const screenOrdinal = venueIndex * 2 + screenIndex;
        const slots = starts.flatMap(evening => {
          const morning = new Date(evening.getTime() - 510 * 60000);
          return [{ startsAt: evening, movie: movies[screenOrdinal]!, slot: '1830-IST' },
            { startsAt: morning, movie: movies[morningFilmIndex(screenOrdinal, morning)]!, slot: '1000-IST' }];
        });
        for (const { startsAt, movie, slot } of slots) {
          const showId = seedId(`show:${screenKey}:${startsAt.toISOString().slice(0,10)}:${slot}`);
          const existing = await tx.show.findUnique({ where: { id: showId }, include: { prices: true } });
          if (existing) {
            if (existing.movieId !== movie.id || existing.screenId !== screen.id || existing.startsAt.getTime() !== startsAt.getTime()) collision('show');
            if (existing.prices.length !== 3 || SEAT_PRICES.some(price => !existing.prices.some(actual => actual.seatType === price.seatType && actual.pricePaise > 0))) collision('show price');
            continue; // Preserve dates, status, duration snapshot, prices and bookings.
          }
          const endsAt = new Date(startsAt.getTime() + movie.durationMinutes * 60000);
          const conflicts = await tx.show.count({ where: { screenId: screen.id, OR: [{ startsAt }, { status: 'SCHEDULED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }] } });
          if (conflicts) collision('show slot');
          await tx.show.create({ data: { id: showId, movieId: movie.id, screenId: screen.id, startsAt, endsAt, status: 'SCHEDULED', prices: { create: SEAT_PRICES.map(price => ({ ...price })) } } });
          result.created.shows++; result.created.prices += 3;
        }
      }
    }
    return result;
  }, { isolationLevel: 'ReadCommitted', maxWait: 60000, timeout: 120000 });
}
