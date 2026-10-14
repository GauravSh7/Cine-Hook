import { api, queryPath } from './client'
import type { EventAvailability, EventQuery, EventSessionDetail, EventSessionQuery, EventSummary } from './event-types'
import type { EventBooking, Page } from './types'

export const eventsApi = {
  list: (query?: EventQuery, signal?: AbortSignal) => api<Page<EventSummary>>(queryPath('/events', query, ['kind', 'cityId', 'search', 'page', 'limit']), { signal }),
  get: (id: string, signal?: AbortSignal) => api<{ event: EventSummary }>(`/events/${encodeURIComponent(id)}`, { signal }),
  sessions: (query?: EventSessionQuery, signal?: AbortSignal) => api<Page<EventSessionDetail>>(queryPath('/event-sessions', query, ['eventId', 'cityId', 'page', 'limit']), { signal }),
  session: (id: string, signal?: AbortSignal) => api<{ session: EventSessionDetail }>(`/event-sessions/${encodeURIComponent(id)}`, { signal }),
  availability: (id: string, signal?: AbortSignal) => api<EventAvailability>(`/event-sessions/${encodeURIComponent(id)}/availability`, { signal }),
  createBooking: (eventSessionId: string, seatIds: string[], signal?: AbortSignal) => api<{ booking: EventBooking }>('/event-bookings', { method: 'POST', body: { eventSessionId, seatIds }, signal }),
}
