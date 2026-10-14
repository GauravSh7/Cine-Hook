import { api, queryPath } from './client'
import type { Availability, City, CityQuery, Movie, MovieQuery, Page, Seat, Show, ShowQuery, Theatre, TheatreDetail, TheatreQuery } from './types'

export const catalogApi = {
  movies: (query?: MovieQuery, signal?: AbortSignal) => api<Page<Movie>>(queryPath('/movies', query, ['page', 'limit', 'search', 'language', 'genre', 'cityId']), { signal }),
  movie: (id: string, signal?: AbortSignal, cityId?: string) => api<{ movie: Movie }>(queryPath(`/movies/${encodeURIComponent(id)}`, { cityId }, ['cityId']), { signal }),
  showDates: (id: string, cityId?: string, signal?: AbortSignal) => api<{ dates: string[]; timeZone: 'Asia/Kolkata' }>(queryPath(`/movies/${encodeURIComponent(id)}/show-dates`, { cityId }, ['cityId']), { signal }),
  cities: (query?: CityQuery, signal?: AbortSignal) => api<Page<City>>(queryPath('/cities', query, ['page', 'limit', 'search', 'state']), { signal }),
  theatres: (query?: TheatreQuery, signal?: AbortSignal) => api<Page<Theatre>>(queryPath('/theatres', query, ['page', 'limit', 'cityId']), { signal }),
  theatre: (id: string, signal?: AbortSignal) => api<{ theatre: TheatreDetail }>(`/theatres/${encodeURIComponent(id)}`, { signal }),
  shows: (query?: ShowQuery, signal?: AbortSignal) => api<Page<Show>>(queryPath('/shows', query, ['page', 'limit', 'movieId', 'cityId', 'theatreId', 'date', 'localDate']), { signal }),
  show: (id: string, signal?: AbortSignal) => api<{ show: Show }>(`/shows/${encodeURIComponent(id)}`, { signal }),
  availability: (showId: string, signal?: AbortSignal) => api<Availability>(`/shows/${encodeURIComponent(showId)}/availability`, { signal }),
  screenSeats: (id: string, signal?: AbortSignal) => api<{ seats: Seat[] }>(`/screens/${encodeURIComponent(id)}/seats`, { signal }),
}
