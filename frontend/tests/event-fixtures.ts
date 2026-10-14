import { booking, city, ids, timestamps } from './fixtures'

export const eventIds = { event: '60000000-0000-4000-8000-000000000001', session: '60000000-0000-4000-8000-000000000002', venue: '60000000-0000-4000-8000-000000000003', front: '60000000-0000-4000-8000-000000000004', rear: '60000000-0000-4000-8000-000000000005' }
export const physicalSeats = [
  { id: '60000000-0000-4000-8000-000000000006', sectionId: eventIds.front, rowName: 'A', seatNumber: 1, ticketTier: 'VIP' as const },
  { id: '60000000-0000-4000-8000-000000000007', sectionId: eventIds.rear, rowName: 'A', seatNumber: 1, ticketTier: 'STANDARD' as const },
  { id: '60000000-0000-4000-8000-000000000008', sectionId: eventIds.rear, rowName: 'A', seatNumber: 4, ticketTier: 'STANDARD' as const },
]
export const sections = [
  { id: eventIds.front, venueId: eventIds.venue, code: 'FRONT', name: 'Front rows', position: 'FRONT', sortOrder: 0, seats: [physicalSeats[0]!] },
  { id: eventIds.rear, venueId: eventIds.venue, code: 'REAR', name: 'Rear rows', position: 'REAR', sortOrder: 1, seats: physicalSeats.slice(1) },
]
export const venue = { id: eventIds.venue, cityId: city.id, name: 'Sample Comedy Hall', address: 'Fictional venue, not an operating address.', kind: 'AUDITORIUM' as const, capacity: 3, ...timestamps, city, sections }
export const prices = [{ sessionId: eventIds.session, ticketTier: 'STANDARD' as const, pricePaise: 40000 }, { sessionId: eventIds.session, ticketTier: 'VIP' as const, pricePaise: 95000 }]
export const event = { id: eventIds.event, slug: 'sample-small-wonders', title: 'Kavya Paperkite: Small Everyday Wonders', description: 'Fictional comedy evening with numbered seats.', kind: 'EVENTS' as const, sport: null, durationMinutes: 75, imageUrl: '/demo-category-art/events.svg', imageAttribution: 'Original CineHook category illustration, CC0. Not official promotional media.', isSample: true, isActive: true, ...timestamps, performers: [{ eventId: eventIds.event, name: 'Kavya Paperkite', biography: 'Invented performer; no real appearance is represented.' }], participants: [] }
export const eventSession = { id: eventIds.session, eventId: eventIds.event, venueId: venue.id, startsAt: '2099-10-10T13:00:00.000Z', endsAt: '2099-10-10T14:15:00.000Z', status: 'SCHEDULED' as const, ...timestamps, event, venue, prices }
export const eventDetail = { ...event, sessions: [eventSession] }
export const eventAvailability = { eventSessionId: eventIds.session, seats: physicalSeats.map((seat, index) => ({ ...seat, section: sections.find(section => section.id === seat.sectionId)!, pricePaise: index === 0 ? 95000 : 40000, availability: index === 2 ? 'BOOKED' as const : 'AVAILABLE' as const, remainingHoldMs: 0 })) }
export const eventBooking = { ...booking, bookingKind: 'EVENT' as const, showId: null, eventSessionId: eventIds.session, totalPaise: 95000, seats: [{ id: '60000000-0000-4000-8000-000000000009', eventSessionId: eventIds.session, seatId: physicalSeats[0]!.id, sectionId: eventIds.front, sectionCode: 'FRONT', sectionName: 'Front rows', rowName: 'A', seatNumber: 1, ticketTier: 'VIP' as const, pricePaise: 95000 }] }
// Shared read projection is smaller than the public session/map DTO.
export const bookingEventSession = {
  id: eventSession.id, eventId: event.id, venueId: venue.id, startsAt: eventSession.startsAt, endsAt: eventSession.endsAt, status: eventSession.status, ...timestamps,
  event: { id: event.id, title: event.title, description: event.description, kind: event.kind, sport: event.sport, imageUrl: event.imageUrl, imageAttribution: event.imageAttribution, isSample: event.isSample },
  venue: { id: venue.id, name: venue.name, address: venue.address, kind: venue.kind, cityId: venue.cityId, city: { id: city.id, name: city.name, state: city.state, countryCode: city.countryCode } },
}
export const eventSummary = { booking: eventBooking, show: null, eventSession: bookingEventSession, payment: null, refunds: [] }
export const eventPath = `/events/bookable/${eventIds.event}`
export const seatPath = `/event-sessions/${eventIds.session}/seats`
export function eventResponse(path: string) {
  if (path === `/api/bookings/${ids.booking}/quote`) return {version:0,label:'Order summary',couponCode:null,subtotalPaise:95000,totalPaise:95000,frozen:true}
  if (path === '/api/events') return { items: [eventDetail], page: 1, limit: 12 }
  if (path === `/api/events/${eventIds.event}`) return { event: eventDetail }
  if (path === '/api/event-sessions') return { items: [eventSession], page: 1, limit: 20 }
  if (path === `/api/event-sessions/${eventIds.session}`) return { session: eventSession }
  if (path.endsWith(`/event-sessions/${eventIds.session}/availability`)) return eventAvailability
  if (path === '/api/event-bookings') return { booking: eventBooking }
  if (path === `/api/bookings/${ids.booking}/summary`) return eventSummary
}
