import { AppError } from '../../errors/app-error.js';
import type { SeatInput, SeatStore } from './show.types.js';

export class SeatService {
  constructor(private readonly seats: SeatStore) {}

  async list(screenId: string) {
    const result = await this.seats.list(screenId);
    if (!result.screen) throw new AppError(404, 'NOT_FOUND', 'Screen not found.');
    return { seats: result.seats };
  }

  initialize(screenId: string, input: SeatInput[]) {
    return this.seats.initialize(screenId, input, ({ screen, seats, showCount }) => {
      if (!screen) throw new AppError(404, 'NOT_FOUND', 'Screen not found.');
      if (showCount > 0) throw new AppError(409, 'LAYOUT_FROZEN', 'Scheduled screen layout is fixed.');
      if (seats.length > 0) throw new AppError(409, 'LAYOUT_EXISTS', 'A physical layout is already configured.');
      if (input.length !== screen.capacity) throw new AppError(400, 'CAPACITY_MISMATCH', 'The layout must match screen capacity.');
      const coordinates = new Set(input.map(seat => `${seat.rowName}:${seat.seatNumber}`));
      if (coordinates.size !== input.length) throw new AppError(400, 'VALIDATION_ERROR', 'Seat coordinates must be unique.');
    });
  }
}
