import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { z } from 'zod';
import type { MovieQuery, Page } from '../catalog/catalog.types.js';
import type { ShowQuery } from '../shows/show.types.js';
import type { BookingReadQuery, DashboardRecord, UiReadStore } from './ui-read.types.js';
import { movieMetadataSelect, upcomingShowInclude } from '../catalog/public-movie.js';

const movieSelect = { id: true, title: true, description: true, durationMinutes: true, releaseDate: true,
  language: true, genres: true, posterUrl: true, isActive: true, createdAt: true, updatedAt: true, ...movieMetadataSelect } as const;
const showSelect = { id: true, movieId: true, screenId: true, startsAt: true, endsAt: true, status: true,
  createdAt: true, updatedAt: true, movie: { select: movieSelect },
  screen: { select: { id: true, name: true, capacity: true, theatreId: true, createdAt: true, updatedAt: true,
    theatre: { select: { id: true, name: true, address: true, cityId: true, createdAt: true, updatedAt: true,
      city: { select: { id: true, name: true, state: true, countryCode: true, createdAt: true, updatedAt: true } } } } } },
  prices: { select: { showId: true, seatType: true, pricePaise: true }, orderBy: { seatType: 'asc' } } } as const;
const paymentSelect = { id: true, bookingId: true, amountPaise: true, currency: true, status: true, providerOrderId: true,
  providerPaymentId: true, capturedAt: true, bookingFinalizedAt: true, failureCode: true, createdAt: true,
  reconciliation: { select: { reason: true, compensationRequired: true, resolvedAt: true } } } as const;
const refundSelect = { id: true, providerPaymentId: true, amountPaise: true, currency: true, reason: true, status: true,
  attempts: { select: { id: true, sequence: true, providerRefundId: true, status: true, lastErrorCode: true, processedAt: true },
    orderBy: { sequence: 'asc' } } } as const;
const seatsSelect = { select: { id: true, showId: true, seatId: true, price: true,
  seat: { select: { rowName: true, seatNumber: true, seatType: true } } }, orderBy: { seatId: 'asc' } } as const;
const eventSeatsSelect = { select: { id: true, eventSessionId: true, eventSeatId: true, price: true,
  seat: { select: { rowName: true, seatNumber: true, ticketTier: true, sectionId: true, section: { select: { code: true, name: true } } } } },
  orderBy: { eventSeatId: 'asc' } } as const;
const eventSessionSelect = { id: true, eventId: true, venueId: true, startsAt: true, endsAt: true, status: true, createdAt: true, updatedAt: true,
  event: { select: { id: true, title: true, description: true, kind: true, sport: true, imageUrl: true, imageAttribution: true, isSample: true } },
  venue: { select: { id: true, name: true, address: true, kind: true, cityId: true,
    city: { select: { id: true, name: true, state: true, countryCode: true } } } } } as const;
const userSelect = { id: true, name: true } as const;
function showSelection() { return { ...showSelect, movie: { select: { ...movieSelect, ...upcomingShowInclude() } } }; }
const paging = (page: Page) => ({ skip: (page.page - 1) * page.limit, take: page.limit });
const literalSearch = (value: string) => value.replace(/[\\%_]/g, '\\$&');

export class UiReadRepository implements UiReadStore {
  constructor(private readonly prisma: PrismaClient) {}

  bookingSummary(owner: string, id: string) {
    return this.prisma.$transaction(async tx => {
      // Financial writers lock Booking before Payment/Refund. Sharing this first
      // lock holds a coherent financial view across Prisma's nested read queries.
      const locked = await tx.$queryRaw<{ id: string; userId: string }[]>(Prisma.sql`
        SELECT id, user_id AS "userId" FROM bookings WHERE id = ${id}::uuid FOR SHARE`);
      if (!locked[0] || locked[0].userId !== owner) return null;
      return tx.booking.findUnique({ where: { id }, select: { id: true, showId: true, status: true, totalPaise: true,
        bookingKind: true, eventSessionId: true, eventSeats: eventSeatsSelect, eventSession: { select: eventSessionSelect },
        expiresAt: true, confirmedAt: true, failureCode: true, createdAt: true, updatedAt: true, seats: seatsSelect,
        show: { select: showSelection() }, payment: { select: { ...paymentSelect,
          refunds: { select: refundSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 5000 });
  }

  async dashboard(): Promise<DashboardRecord> {
    const rows = await this.prisma.$queryRaw<DashboardRecord[]>(Prisma.sql`
      WITH bounds AS (
        SELECT CURRENT_TIMESTAMP AS now,
          date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS day_start,
          (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC' AS day_end
      )
      SELECT (SELECT count(*) FROM movies)::bigint AS "totalMovies",
        (SELECT count(*) FROM shows s JOIN movies m ON m.id = s.movie_id
          WHERE s.status = 'SCHEDULED' AND m.is_active AND s.starts_at > bounds.now)::bigint AS "activeShows",
        (SELECT count(*) FROM bookings b
          WHERE b.created_at >= (bounds.day_start AT TIME ZONE 'UTC')
            AND b.created_at < (bounds.day_end AT TIME ZONE 'UTC'))::bigint AS "bookingsToday",
        (SELECT COALESCE(sum(p.amount_paise), 0) FROM payments p
          WHERE p.captured_at >= bounds.day_start AND p.captured_at < bounds.day_end)::bigint AS "capturedTodayPaise"
      FROM bounds`);
    return rows[0]!;
  }

  movies(query: MovieQuery) {
    const where: Prisma.MovieWhereInput = {};
    if (query.search) where.title = { contains: literalSearch(query.search), mode: 'insensitive' };
    if (query.language) where.language = query.language;
    if (query.genre) where.genres = { has: query.genre };
    return this.prisma.movie.findMany({ where, select: { ...movieSelect, ...upcomingShowInclude(query.cityId) }, orderBy: [{ title: 'asc' }, { id: 'asc' }], ...paging(query) });
  }

  shows(query: ShowQuery) {
    const day = query.localDate ?? query.date;
    return this.prisma.show.findMany({ where: { movieId: query.movieId,
      screen: { theatreId: query.theatreId, theatre: { cityId: query.cityId } },
      ...(day ? { startsAt: { gte: day, lt: new Date(day.getTime() + 86400000) } } : {}),
    }, select: showSelection(), orderBy: [{ startsAt: 'desc' }, { id: 'desc' }], ...paging(query) });
  }

  bookings(query: BookingReadQuery) {
    const where: Prisma.BookingWhereInput = {};
    if (query.search) {
      where.OR = [{ user: { name: { contains: literalSearch(query.search), mode: 'insensitive' } } }];
      if (z.string().uuid().safeParse(query.search).success) where.OR.push({ id: query.search.toLowerCase() });
    }
    return this.prisma.booking.findMany({ where, select: { id: true, status: true, totalPaise: true, expiresAt: true,
      bookingKind: true, eventSessionId: true, eventSeats: eventSeatsSelect, eventSession: { select: eventSessionSelect },
      createdAt: true, user: { select: userSelect }, seats: seatsSelect,
      show: { select: { id: true, startsAt: true, movie: { select: { id: true, title: true } },
        screen: { select: { id: true, name: true, theatre: { select: { id: true, name: true } } } } } },
      payment: { select: { id: true, status: true, amountPaise: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...paging(query) });
  }

  payments(query: Page) {
    return this.prisma.payment.findMany({ where: {}, select: { ...paymentSelect,
      booking: { select: { id: true, status: true, user: { select: userSelect } } },
      refunds: { select: { id: true, status: true, amountPaise: true, providerPaymentId: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...paging(query) });
  }
}
