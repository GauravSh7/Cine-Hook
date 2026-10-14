import { AppError } from '../../errors/app-error.js';
import type { EventCatalog, EventQuery, EventSessionQuery, EventStore } from './event.types.js';

export class EventService implements EventCatalog {
  constructor(private readonly store: EventStore, private readonly now: () => Date = () => new Date()) {}
  private async validateCity(cityId?: string) {
    if (cityId && !await this.store.cityExists(cityId)) throw new AppError(404, 'CITY_NOT_FOUND', 'City could not be found.');
  }
  async list(query: EventQuery) {
    await this.validateCity(query.cityId);
    return { items: await this.store.list(query, this.now()), page: query.page, limit: query.limit };
  }
  async getById(id: string) {
    const event = await this.store.findById(id, this.now());
    if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event could not be found.');
    return event;
  }
  async listSessions(query: EventSessionQuery) {
    await this.validateCity(query.cityId);
    return { items: await this.store.listSessions(query, this.now()), page: query.page, limit: query.limit };
  }
  async getSessionById(id: string) {
    const session = await this.store.findSessionById(id, this.now());
    if (!session) throw new AppError(404, 'EVENT_SESSION_NOT_FOUND', 'Event session could not be found.');
    return session;
  }
}
