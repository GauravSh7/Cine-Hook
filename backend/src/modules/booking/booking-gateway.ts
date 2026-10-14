import { AppError } from '../../errors/app-error.js';
import type { Page } from '../catalog/catalog.types.js';
import type { EventBookingService } from '../event-booking/event-booking.service.js';
import type { BookingService } from './booking.service.js';
import type { BookingConfirmationScope, BookingInput } from './booking.types.js';
import type { BookingTargets } from './booking-target.repository.js';

const missing = () => new AppError(404, 'NOT_FOUND', 'Booking not found.');
// Domain selection always comes from the immutable persisted target. HTTP never
// supplies a discriminator, payment success, allocation or refund completion.
export class BookingGateway {
  constructor(private readonly targets: BookingTargets, private readonly movies: BookingService, private readonly events: EventBookingService) {}
  private async domain(id: string, owner?: string, scope?: BookingConfirmationScope) {
    if (scope?.target) {
      const kind = await scope.target(id.toLowerCase());
      if (!kind) throw missing();
      return kind === 'EVENT' ? this.events : this.movies;
    }
    const kind = await this.targets.findTarget(id.toLowerCase(), owner?.toLowerCase());
    if (!kind) throw missing();
    return kind === 'EVENT' ? this.events : this.movies;
  }
  create(userId: string, input: BookingInput) { return this.movies.create(userId, input); }
  availability(showId: string) { return this.movies.availability(showId); }
  async getById(userId: string, id: string) { return (await this.domain(id, userId)).getById(userId, id); }
  async payable(userId: string, id: string) { return (await this.domain(id, userId)).payable(userId, id); }
  async releaseHold(userId: string, id: string) { return (await this.domain(id, userId)).releaseHold(userId, id); }
  async confirm(id: string, scope?: BookingConfirmationScope) { return (await this.domain(id, undefined, scope)).confirm(id, scope); }
  async failUnfulfilled(id: string, reason: string, scope: BookingConfirmationScope) { return (await this.domain(id, undefined, scope)).failUnfulfilled(id, reason, scope); }
  async cancel(userId: string, id: string, scope: BookingConfirmationScope) { return (await this.domain(id, userId, scope)).cancel(userId, id, scope); }
  async list(userId: string, page: Page) {
    const references = await this.targets.referencesByUser(userId.toLowerCase(), page);
    const items = [];
    for (const reference of references) items.push(await this.getById(userId, reference.id));
    return { items, page: page.page, limit: page.limit };
  }
}

export type FinancialBookings = Pick<BookingGateway, 'payable' | 'confirm' | 'failUnfulfilled' | 'cancel'> | Pick<BookingService, 'payable' | 'confirm' | 'failUnfulfilled' | 'cancel'>;
