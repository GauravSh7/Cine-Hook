import { randomUUID } from 'node:crypto';
import type { Seat } from '../../src/generated/prisma/client.js';
import { AppError } from '../../src/errors/app-error.js';
import { SeatService } from '../../src/modules/shows/seat.service.js';
import { ShowService } from '../../src/modules/shows/show.service.js';
import type { ShowDetail, ShowStore, SeatStore } from '../../src/modules/shows/show.types.js';
import type { testCatalog } from './catalog.js';

// Only repository I/O is substituted: services retain validation and scheduling policy.
export function testShows(catalog: ReturnType<typeof testCatalog>) {
  const seats = new Map<string, Seat>();
  const shows = new Map<string, ShowDetail>();
  const screenSeats = (screenId: string) => [...seats.values()].filter(s => s.screenId === screenId)
    .sort((a, b) => a.rowName.localeCompare(b.rowName) || a.seatNumber - b.seatNumber);
  const detail = (show: ShowDetail): ShowDetail => {
    const screen = catalog.screens.get(show.screenId)!;
    const theatre = catalog.theatres.get(screen.theatreId)!;
    return { ...show, movie: catalog.movies.get(show.movieId)!, screen: { ...screen, theatre: { ...theatre, city: catalog.cities.get(theatre.cityId)! } } };
  };
  const seatStore: SeatStore = {
    list: async screenId => ({ screen: catalog.screens.get(screenId) ?? null, seats: screenSeats(screenId) }),
    initialize: async (screenId, input, validate) => {
      validate({ screen: catalog.screens.get(screenId) ?? null, seats: screenSeats(screenId), showCount: [...shows.values()].filter(s => s.screenId === screenId).length });
      const values = input.map(s => ({ ...s, id: randomUUID(), screenId }));
      for (const seat of values) seats.set(seat.id, seat);
      return values;
    },
  };
  const showStore: ShowStore = {
    list: async (query, asOf) => [...shows.values()].map(detail)
      .filter(s => s.status === 'SCHEDULED' && s.movie.isActive && s.startsAt >= asOf
        && (!query.movieId || s.movieId === query.movieId) && (!query.cityId || s.screen.theatre.cityId === query.cityId)
        && (!query.theatreId || s.screen.theatreId === query.theatreId)
        && (!query.date || (s.startsAt >= query.date && s.startsAt.getTime() < query.date.getTime() + 86400000)))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))
      .slice((query.page - 1) * query.limit, query.page * query.limit),
    findById: async id => shows.has(id) ? detail(shows.get(id)!) : null,
    listSeats: async screenId => screenSeats(screenId),
    schedule: async (input, prepare) => {
      const prepared = prepare({ movie: catalog.movies.get(input.movieId) ?? null, screen: catalog.screens.get(input.screenId) ?? null, seats: screenSeats(input.screenId) });
      if ([...shows.values()].some(s => s.screenId === input.screenId && s.status === 'SCHEDULED'
        && s.startsAt < prepared.endsAt && s.endsAt > prepared.startsAt)) throw new AppError(409, 'SHOW_OVERLAP', 'Screen already has an overlapping show.');
      const id = randomUUID(); const now = new Date();
      const screen = catalog.screens.get(input.screenId)!; const theatre = catalog.theatres.get(screen.theatreId)!;
      const show: ShowDetail = { id, movieId: input.movieId, screenId: input.screenId, startsAt: prepared.startsAt, endsAt: prepared.endsAt,
        status: 'SCHEDULED', createdAt: now, updatedAt: now, movie: catalog.movies.get(input.movieId)!,
        screen: { ...screen, theatre: { ...theatre, city: catalog.cities.get(theatre.cityId)! } },
        prices: prepared.prices.map(p => ({ ...p, showId: id })) };
      shows.set(id, show); return show;
    },
  };
  return { seats, shows, services: { seats: new SeatService(seatStore), shows: new ShowService(showStore, () => new Date('2030-01-01T00:00:00Z')) } };
}
