import { api, queryPath } from './client'
import type { AdminBooking, AdminBookingQuery, AdminPayment, Dashboard, Movie, MovieInput, MovieQuery, Page, PageQuery, Show, ShowInput, ShowQuery } from './types'

function movieBody(input: Partial<MovieInput>): Partial<MovieInput> {
  const { title, description, durationMinutes, releaseDate, language, genres, posterUrl } = input
  return { title, description, durationMinutes, releaseDate, language, genres, posterUrl }
}
export const adminApi = {
  dashboard: (signal?: AbortSignal) => api<Dashboard>('/admin/dashboard', { signal }),
  movies: (query?: MovieQuery, signal?: AbortSignal) => api<Page<Movie>>(queryPath('/admin/movies', query, ['page', 'limit', 'search', 'language', 'genre']), { signal }),
  shows: (query?: ShowQuery, signal?: AbortSignal) => api<Page<Show>>(queryPath('/admin/shows', query, ['page', 'limit', 'movieId', 'cityId', 'theatreId', 'date']), { signal }),
  bookings: (query?: AdminBookingQuery, signal?: AbortSignal) => api<Page<AdminBooking>>(queryPath('/admin/bookings', query, ['page', 'limit', 'search']), { signal }),
  payments: (query?: PageQuery, signal?: AbortSignal) => api<Page<AdminPayment>>(queryPath('/admin/payments', query, ['page', 'limit']), { signal }),
  createMovie: (input: MovieInput, signal?: AbortSignal) => api<{ movie: Movie }>('/admin/movies', { method: 'POST', body: movieBody(input), signal }),
  updateMovie: (id: string, input: Partial<MovieInput>, signal?: AbortSignal) => api<{ movie: Movie }>(`/admin/movies/${encodeURIComponent(id)}`, { method: 'PATCH', body: movieBody(input), signal }),
  disableMovie: (id: string, signal?: AbortSignal) => api<{ movie: Movie }>(`/admin/movies/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
  createShow: (input: ShowInput, signal?: AbortSignal) => api<{ show: Show }>('/admin/shows', { method: 'POST', signal, body: { movieId: input.movieId, screenId: input.screenId, startsAt: input.startsAt, prices: input.prices.map(price => ({ seatType: price.seatType, pricePaise: price.pricePaise })) } }),
  reconcileRefunds: (signal?: AbortSignal) => api<{ examined: number }>('/admin/refunds/reconcile', { method: 'POST', body: {}, signal }),
}
