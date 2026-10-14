import type { City, PageQuery, Timestamps } from './types'

export type EventKind = 'EVENTS' | 'SPORTS' | 'ACTIVITIES'
export type EventTicketTier = 'STANDARD' | 'PREMIUM' | 'VIP'
export interface EventRecord extends Timestamps { id: string; slug: string; title: string; description: string; kind: EventKind; sport: string | null; durationMinutes: number; imageUrl: string | null; imageAttribution: string | null; isSample: boolean; isActive: boolean }
export interface EventPeople { performers: { eventId: string; name: string; biography: string }[]; participants: { eventId: string; name: string }[] }
export interface EventSeat { id: string; sectionId: string; rowName: string; seatNumber: number; ticketTier: EventTicketTier }
export interface EventSection { id: string; venueId: string; code: string; name: string; position: string; sortOrder: number; seats: EventSeat[] }
export interface EventVenue extends Timestamps { id: string; cityId: string; name: string; address: string; kind: 'AUDITORIUM' | 'STADIUM' | 'ARENA'; capacity: number; city: City }
export interface EventSessionPrice { sessionId: string; ticketTier: EventTicketTier; pricePaise: number }
export interface EventSessionRecord extends Timestamps { id: string; eventId: string; venueId: string; startsAt: string; endsAt: string; status: 'SCHEDULED' | 'CANCELLED' }
export interface EventSessionSummary extends EventSessionRecord { venue: EventVenue; prices: EventSessionPrice[] }
export interface EventSummary extends EventRecord, EventPeople { sessions: EventSessionSummary[] }
export interface EventSessionDetail extends EventSessionSummary { event: EventRecord & EventPeople; venue: EventVenue & { sections: EventSection[] } }
// The shared booking read deliberately has a smaller event/venue projection.
export interface EventSessionBooking extends EventSessionRecord {
  event: Pick<EventRecord, 'id' | 'title' | 'description' | 'kind' | 'sport' | 'imageUrl' | 'imageAttribution' | 'isSample'>
  venue: Pick<EventVenue, 'id' | 'name' | 'address' | 'kind' | 'cityId'> & { city: Pick<City, 'id' | 'name' | 'state' | 'countryCode'> }
}
export interface EventAvailabilitySeat extends EventSeat { section: Omit<EventSection, 'seats'>; pricePaise: number; availability: 'AVAILABLE' | 'LOCKED' | 'BOOKED'; remainingHoldMs: number }
export interface EventAvailability { eventSessionId: string; seats: EventAvailabilitySeat[] }
export interface EventSeatQuote { sectionId: string; sectionCode: string; sectionName: string; rowName: string; seatNumber: number; ticketTier: EventTicketTier; pricePaise: number }
export interface EventBookingSeat extends EventSeatQuote { id: string; eventSessionId: string; seatId: string }
export interface EventQuery extends PageQuery { kind?: EventKind; cityId?: string; search?: string }
export interface EventSessionQuery extends PageQuery { eventId?: string; cityId?: string }
