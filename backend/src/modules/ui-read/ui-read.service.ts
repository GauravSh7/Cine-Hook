import { AppError } from '../../errors/app-error.js';
import { publicMovie } from '../catalog/public-movie.js';
import type { BookingServices } from '../booking/booking.types.js';
import type { MovieQuery, Page } from '../catalog/catalog.types.js';
import type { ShowDetail, ShowQuery } from '../shows/show.types.js';
import type { BookingReadQuery, UiBookingSeatRecord, UiEventSeatRecord, UiPaymentRecord, UiReadStore, UiRefundRecord } from './ui-read.types.js';

function safeNumber(value: bigint | number) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new AppError(500, 'INTERNAL_ERROR', 'Unable to read data.');
  return result;
}
function publicShow(show: ShowDetail) {
  const { screen } = show, { theatre } = screen, { city } = theatre;
  return { id: show.id, movieId: show.movieId, screenId: show.screenId, startsAt: show.startsAt, endsAt: show.endsAt,
    status: show.status, createdAt: show.createdAt, updatedAt: show.updatedAt, movie: publicMovie(show.movie),
    screen: { id: screen.id, name: screen.name, capacity: screen.capacity, theatreId: screen.theatreId,
      createdAt: screen.createdAt, updatedAt: screen.updatedAt,
      theatre: { id: theatre.id, name: theatre.name, address: theatre.address, cityId: theatre.cityId,
        createdAt: theatre.createdAt, updatedAt: theatre.updatedAt,
        city: { id: city.id, name: city.name, state: city.state, countryCode: city.countryCode,
          createdAt: city.createdAt, updatedAt: city.updatedAt } } },
    prices: show.prices.map(price => ({ showId: price.showId, seatType: price.seatType, pricePaise: safeNumber(price.pricePaise) })) };
}
function publicPayment(payment: UiPaymentRecord) {
  return { id: payment.id, bookingId: payment.bookingId, amountPaise: safeNumber(payment.amountPaise), currency: payment.currency,
    status: payment.status, providerOrderId: payment.providerOrderId, providerPaymentId: payment.providerPaymentId,
    capturedAt: payment.capturedAt, bookingFinalizedAt: payment.bookingFinalizedAt, failureCode: payment.failureCode,
    reconciliation: payment.reconciliation ? { reason: payment.reconciliation.reason,
      compensationRequired: payment.reconciliation.compensationRequired, resolvedAt: payment.reconciliation.resolvedAt } : null };
}
function publicRefund(refund: UiRefundRecord) {
  return { id: refund.id, providerPaymentId: refund.providerPaymentId, amountPaise: safeNumber(refund.amountPaise),
    currency: refund.currency, reason: refund.reason, status: refund.status,
    attempts: refund.attempts.map(attempt => ({ id: attempt.id, sequence: attempt.sequence, providerRefundId: attempt.providerRefundId,
      status: attempt.status, lastErrorCode: attempt.lastErrorCode, processedAt: attempt.processedAt })) };
}
function seatQuote(item: UiBookingSeatRecord) {
  return { rowName: item.seat.rowName, seatNumber: item.seat.seatNumber, seatType: item.seat.seatType, pricePaise: safeNumber(item.price) };
}
function eventSeatQuote(item: UiEventSeatRecord) {
  return { rowName: item.seat.rowName, seatNumber: item.seat.seatNumber, ticketTier: item.seat.ticketTier,
    sectionId: item.seat.sectionId, sectionCode: item.seat.section.code, sectionName: item.seat.section.name, pricePaise: safeNumber(item.price) };
}
function pageResult<T>(items: T[], query: Page) { return { items, page: query.page, limit: query.limit }; }

export class UiReadService {
  constructor(private readonly store: UiReadStore, private readonly bookingService: Pick<BookingServices['bookings'], 'getById'>) {}

  async bookingSummary(owner: string, id: string) {
    const userId = owner.toLowerCase(), bookingId = id.toLowerCase();
    await this.bookingService.getById(userId, bookingId);
    const booking = await this.store.bookingSummary(userId, bookingId);
    if (!booking) throw new AppError(404, 'NOT_FOUND', 'Booking not found.');
    if (booking.bookingKind === 'EVENT') {
      if (!booking.eventSession || !booking.eventSeats) throw new AppError(500, 'INTERNAL_ERROR', 'Unable to read event booking.');
      return { booking: { id: booking.id, bookingKind: 'EVENT', showId: null, eventSessionId: booking.eventSessionId,
        status: booking.status, totalPaise: safeNumber(booking.totalPaise), expiresAt: booking.expiresAt, confirmedAt: booking.confirmedAt,
        failureCode: booking.failureCode, createdAt: booking.createdAt, updatedAt: booking.updatedAt,
        seats: booking.eventSeats.map(item => ({ id: item.id, eventSessionId: item.eventSessionId, seatId: item.eventSeatId, ...eventSeatQuote(item) })) },
        show: null, eventSession: booking.eventSession, payment: booking.payment ? publicPayment(booking.payment) : null,
        refunds: booking.payment?.refunds.map(publicRefund) ?? [] };
    }
    if (!booking.show) throw new AppError(500, 'INTERNAL_ERROR', 'Unable to read booking.');
    return { booking: { id: booking.id, showId: booking.showId, status: booking.status, totalPaise: safeNumber(booking.totalPaise),
      expiresAt: booking.expiresAt, confirmedAt: booking.confirmedAt, failureCode: booking.failureCode,
      createdAt: booking.createdAt, updatedAt: booking.updatedAt,
      seats: booking.seats.map(item => ({ id: item.id, showId: item.showId, seatId: item.seatId, ...seatQuote(item) })) },
    show: publicShow(booking.show), payment: booking.payment ? publicPayment(booking.payment) : null,
    refunds: booking.payment?.refunds.map(publicRefund) ?? [] };
  }

  async dashboard() {
    const stats = await this.store.dashboard();
    return { totalMovies: safeNumber(stats.totalMovies), activeShows: safeNumber(stats.activeShows),
      bookingsToday: safeNumber(stats.bookingsToday), capturedTodayPaise: safeNumber(stats.capturedTodayPaise) };
  }
  async movies(query: MovieQuery) { return pageResult((await this.store.movies(query)).map(movie => publicMovie(movie, query.cityId)), query); }
  async shows(query: ShowQuery) { return pageResult((await this.store.shows(query)).map(publicShow), query); }
  async bookings(query: BookingReadQuery) {
    return pageResult((await this.store.bookings(query)).map(booking => {
      if (booking.bookingKind === 'EVENT') {
        if (!booking.eventSession || !booking.eventSeats) throw new AppError(500, 'INTERNAL_ERROR', 'Unable to read event booking.');
        return { id: booking.id, bookingKind: 'EVENT', user: { id: booking.user.id, name: booking.user.name }, show: null,
          eventSession: booking.eventSession, status: booking.status, totalPaise: safeNumber(booking.totalPaise), expiresAt: booking.expiresAt,
          createdAt: booking.createdAt, seats: booking.eventSeats.map(eventSeatQuote),
          payment: booking.payment ? { id: booking.payment.id, status: booking.payment.status, amountPaise: safeNumber(booking.payment.amountPaise) } : null };
      }
      if (!booking.show) throw new AppError(500, 'INTERNAL_ERROR', 'Unable to read booking.');
      return { id: booking.id,
      user: { id: booking.user.id, name: booking.user.name },
      show: { id: booking.show.id, startsAt: booking.show.startsAt, movie: { id: booking.show.movie.id, title: booking.show.movie.title },
        screen: { id: booking.show.screen.id, name: booking.show.screen.name,
          theatre: { id: booking.show.screen.theatre.id, name: booking.show.screen.theatre.name } } },
      status: booking.status, totalPaise: safeNumber(booking.totalPaise), expiresAt: booking.expiresAt, createdAt: booking.createdAt,
      seats: booking.seats.map(seatQuote),
      payment: booking.payment ? { id: booking.payment.id, status: booking.payment.status, amountPaise: safeNumber(booking.payment.amountPaise) } : null,
    }; }), query);
  }
  async payments(query: Page) {
    return pageResult((await this.store.payments(query)).map(payment => ({ ...publicPayment(payment), createdAt: payment.createdAt,
      booking: { id: payment.booking.id, status: payment.booking.status, user: { id: payment.booking.user.id, name: payment.booking.user.name } },
      refunds: payment.refunds.map(refund => ({ id: refund.id, status: refund.status,
        amountPaise: safeNumber(refund.amountPaise), providerPaymentId: refund.providerPaymentId })) })), query);
  }
}
