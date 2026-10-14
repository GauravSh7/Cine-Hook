import { api, queryPath } from './client'
import type { Booking, BookingSummary, Page, PageQuery, RefundView } from './types'

export const bookingApi = {
  create: (showId: string, seatIds: string[], signal?: AbortSignal) => api<{ booking: Booking }>('/bookings', { method: 'POST', body: { showId, seatIds }, signal }),
  get: (id: string, signal?: AbortSignal) => api<{ booking: Booking }>(`/bookings/${encodeURIComponent(id)}`, { signal }),
  summary: (id: string, signal?: AbortSignal) => api<BookingSummary>(`/bookings/${encodeURIComponent(id)}/summary`, { signal }),
  list: (query?: PageQuery, signal?: AbortSignal) => api<Page<Booking>>(queryPath('/bookings', query, ['page', 'limit']), { signal }),
  release: (id: string, signal?: AbortSignal) => api<{ booking: Booking }>(`/bookings/${encodeURIComponent(id)}/hold`, { method: 'DELETE', signal }),
  cancelCheckout: (id:string)=>api<{booking:{id:string;status:string}}>(`/bookings/${encodeURIComponent(id)}/checkout/cancel`,{method:'POST',body:{}}),
  cancel: (id: string, signal?: AbortSignal) => api<RefundView>(`/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {}, signal }),
  retryRefund: (id: string, signal?: AbortSignal) => api<RefundView>(`/bookings/${encodeURIComponent(id)}/refund/retry`, { method: 'POST', body: {}, signal }),
  refunds: (id: string, signal?: AbortSignal) => api<RefundView>(`/bookings/${encodeURIComponent(id)}/refunds`, { signal }),
}
