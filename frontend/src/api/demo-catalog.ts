import { api, queryPath } from './client'
import type { Page } from './types'
export type DemoKind = 'stream' | 'events' | 'sports' | 'activities'
export interface DemoListing { id: string; slug: string; kind: 'STREAM' | 'EVENTS' | 'SPORTS' | 'ACTIVITIES'; title: string; description: string; category: string; cityName: string | null; venueName: string | null; startsAt: string | null; durationMinutes: number | null; imageUrl: string; imageAttribution: string; isDemo: true; bookingAvailable: false }
export const demoCatalogApi = {
  list: (kind: DemoKind, query: { cityId?: string; category?: string; search?: string; page?: number; limit?: number }, signal: AbortSignal) => api<Page<DemoListing>>(queryPath(`/demo-catalog/${kind}`, query, ['cityId','category','search','page','limit']), { signal }),
  get: (kind: DemoKind, id: string, signal: AbortSignal) => api<{ listing: DemoListing }>(`/demo-catalog/${kind}/${encodeURIComponent(id)}`, { signal }),
}
