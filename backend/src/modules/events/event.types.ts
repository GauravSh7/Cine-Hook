import type { City, Event, EventParticipant, EventPerformer, EventSection, EventSeat, EventSession, EventSessionPrice, EventVenue, EventKind } from '../../generated/prisma/client.js';
import type { Page } from '../catalog/catalog.types.js';

export type EventQuery = Page & { kind?: EventKind; cityId?: string; search?: string };
export type EventSessionQuery = Page & { eventId?: string; cityId?: string };
export type EventSectionDetail = EventSection & { seats: EventSeat[] };
export type EventVenueSummary = EventVenue & { city: City };
export type EventVenueDetail = EventVenueSummary & { sections: EventSectionDetail[] };
export type EventSessionSummary = EventSession & { venue: EventVenueSummary; prices: EventSessionPrice[] };
export type EventSummary = Event & { performers: EventPerformer[]; participants: EventParticipant[]; sessions: EventSessionSummary[] };
export type EventDetail = EventSummary;
export type EventSessionDetail = EventSession & { event: Event & { performers: EventPerformer[]; participants: EventParticipant[] }; venue: EventVenueDetail; prices: EventSessionPrice[] };
export type EventPage<T> = Page & { items: T[] };

export interface EventStore {
  cityExists(id: string): Promise<boolean>;
  list(query: EventQuery, asOf: Date): Promise<EventSummary[]>;
  findById(id: string, asOf: Date): Promise<EventDetail | null>;
  listSessions(query: EventSessionQuery, asOf: Date): Promise<EventSessionDetail[]>;
  findSessionById(id: string, asOf: Date): Promise<EventSessionDetail | null>;
}
export interface EventCatalog {
  list(query: EventQuery): Promise<EventPage<EventSummary>>;
  getById(id: string): Promise<EventDetail>;
  listSessions(query: EventSessionQuery): Promise<EventPage<EventSessionDetail>>;
  getSessionById(id: string): Promise<EventSessionDetail>;
}
