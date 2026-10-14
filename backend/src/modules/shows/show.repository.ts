import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import type { PreparedShow, ScheduleContext, ShowInput, ShowQuery, ShowStore } from './show.types.js';
import { schedulingWrite } from './scheduling-write.js';
import { upcomingShowInclude } from '../catalog/public-movie.js';

const include = { movie: true, screen: { include: { theatre: { include: { city: true } } } },
  prices: { orderBy: { seatType: 'asc' as const } } } as const;
const seatOrder = [{ rowName: 'asc' as const }, { seatNumber: 'asc' as const }];
function showInclude(cityId?: string) { return { ...include, movie: { include: upcomingShowInclude(cityId) } }; }

export class ShowRepository implements ShowStore {
  constructor(private readonly prisma: PrismaClient) {}

  list(query: ShowQuery, asOf: Date) {
    const day = query.localDate ?? query.date;
    const nextDay = day ? new Date(day.getTime() + 86400000) : undefined;
    return this.prisma.show.findMany({ where: { status: 'SCHEDULED', movie: { isActive: true },
      movieId: query.movieId, screen: { theatreId: query.theatreId, theatre: { cityId: query.cityId } },
      startsAt: { gte: day && day > asOf ? day : asOf, lt: nextDay },
    }, include: showInclude(query.cityId), orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    skip: (query.page - 1) * query.limit, take: query.limit });
  }

  findById(id: string) { return this.prisma.show.findUnique({ where: { id }, include: showInclude() }); }
  listSeats(screenId: string) { return this.prisma.seat.findMany({ where: { screenId }, orderBy: seatOrder }); }

  schedule(input: ShowInput, prepare: (context: ScheduleContext) => PreparedShow) {
    return schedulingWrite(() => this.prisma.$transaction(async tx => {
      const parent = await tx.screen.findUnique({ where: { id: input.screenId }, select: { theatreId: true } });
      if (parent) await tx.$queryRaw(Prisma.sql`SELECT id FROM theatres WHERE id = ${parent.theatreId}::uuid FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM screens WHERE id = ${input.screenId}::uuid FOR UPDATE`);
      const screen = await tx.screen.findUnique({ where: { id: input.screenId } });
      if (screen && screen.theatreId !== parent?.theatreId) throw new AppError(409, 'CONCURRENT_CHANGE', 'The screen venue changed. Retry the request.');
      await tx.$queryRaw(Prisma.sql`SELECT id FROM movies WHERE id = ${input.movieId}::uuid FOR SHARE`);
      const movie = await tx.movie.findUnique({ where: { id: input.movieId } });
      const seats = await tx.seat.findMany({ where: { screenId: input.screenId }, orderBy: seatOrder });
      const prepared = prepare({ screen, movie, seats });
      return tx.show.create({ data: { movieId: input.movieId, screenId: input.screenId,
        startsAt: prepared.startsAt, endsAt: prepared.endsAt,
        prices: { create: prepared.prices },
      }, include: showInclude() });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }
}
