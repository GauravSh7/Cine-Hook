import { AppError } from '../../errors/app-error.js';
import type { ShowInput, ShowQuery, ShowStore } from './show.types.js';
import { publicMovie } from '../catalog/public-movie.js';

export class ShowService {
  constructor(private readonly shows: ShowStore, private readonly now: () => Date = () => new Date()) {}

  async list(query: ShowQuery) {
    const now = this.now();
    return { items: (await this.shows.list(query, now)).map(show => ({ ...show, movie: publicMovie(show.movie, query.cityId, now) })), page: query.page, limit: query.limit };
  }

  async getById(id: string) {
    const show = await this.shows.findById(id);
    if (!show || show.status !== 'SCHEDULED' || !show.movie.isActive) {
      throw new AppError(404, 'NOT_FOUND', 'Show not found.');
    }
    return { ...show, movie: publicMovie(show.movie, undefined, this.now()) };
  }

  create(input: ShowInput) {
    return this.shows.schedule(input, ({ movie, screen, seats }) => {
      if (!movie || !screen) throw new AppError(404, 'NOT_FOUND', 'Movie or screen not found.');
      if (!movie.isActive) throw new AppError(404, 'NOT_FOUND', 'Movie not found.');
      if (seats.length !== screen.capacity || seats.length === 0) {
        throw new AppError(409, 'LAYOUT_INCOMPLETE', 'Configure a complete seat layout before scheduling.');
      }
      const types = new Set(seats.map(seat => seat.seatType));
      const pricedTypes = new Set(input.prices.map(price => price.seatType));
      if (pricedTypes.size !== input.prices.length || types.size !== pricedTypes.size
        || [...types].some(type => !pricedTypes.has(type))) {
        throw new AppError(400, 'PRICE_COVERAGE', 'Provide one price for each seat type in the layout.');
      }
      if (input.prices.some(price => !Number.isInteger(price.pricePaise) || price.pricePaise <= 0 || price.pricePaise > 2147483647)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Prices must be positive integer paise amounts.');
      }
      const endsAt = new Date(input.startsAt.getTime() + movie.durationMinutes * 60000);
      if (!Number.isFinite(input.startsAt.getTime()) || !Number.isFinite(endsAt.getTime())
        || endsAt.getUTCFullYear() < 1 || endsAt.getUTCFullYear() > 9999) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid scheduling time.');
      }
      return { startsAt: input.startsAt, endsAt, prices: input.prices };
    }).then(show => ({ ...show, movie: publicMovie(show.movie, undefined, this.now()) }));
  }

  async getSeats(id: string) {
    const show = await this.getById(id);
    const prices = new Map(show.prices.map(price => [price.seatType, price.pricePaise]));
    const seats = await this.shows.listSeats(show.screenId);
    return { showId: id, seats: seats.map(seat => {
      const pricePaise = prices.get(seat.seatType);
      if (pricePaise === undefined) throw new AppError(409, 'PRICE_COVERAGE', 'Show pricing is incomplete.');
      return { ...seat, pricePaise };
    }) };
  }
}
