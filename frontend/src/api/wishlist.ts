import { api, queryPath } from './client'
import type { Movie, Page, PageQuery } from './types'

export interface SavedMovie { movie: Movie; createdAt: string }
export const wishlistApi = {
  list: (query?: PageQuery, signal?: AbortSignal) => api<Page<SavedMovie>>(queryPath('/wishlist/movies', query, ['page', 'limit']), { signal }),
  status: (id: string, signal?: AbortSignal) => api<{ saved: boolean }>(`/wishlist/movies/${encodeURIComponent(id)}`, { signal }),
  save: (id: string, signal?: AbortSignal) => api<{ saved: boolean }>(`/wishlist/movies/${encodeURIComponent(id)}`, { method: 'PUT', body: {}, signal }),
  remove: (id: string, signal?: AbortSignal) => api<{ saved: boolean }>(`/wishlist/movies/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
}
