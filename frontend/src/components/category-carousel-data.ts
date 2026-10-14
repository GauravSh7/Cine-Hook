import type { DemoKind, DemoListing } from '../api/demo-catalog'
import type { EventSummary } from '../api/event-types'
import { experiencePhoto } from '../domain/experience-media'

export interface CategorySlide {
  id: string
  title: string
  image: string
  href: string
  action: 'Explore' | 'Book Now'
  date?: string
}

export function catalogueText(text: string): string {
  return text.replace(/\b(demo|fictional|seed|sample|development|illustrative|prototype)\b/gi, '')
    .replace(/\s*[—-]\s*$/, '').replace(/\s{2,}/g, ' ').trim()
}

export function categorySlides(category: DemoKind, listings: DemoListing[], events: EventSummary[], cityId: string, now: number): CategorySlide[] {
  const inventory = category === 'stream' ? [] : events
    .filter(event => event.kind.toLowerCase() === category && event.isActive)
    .flatMap(event => {
      const session = event.sessions
        .filter(session => session.status === 'SCHEDULED' && Date.parse(session.startsAt) > now && (!cityId || session.venue.cityId === cityId))
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0]
      return session ? [{ id: `event:${event.id}`, title: catalogueText(event.title), image: experiencePhoto(category, event.imageUrl, event.id),
        href: `/${category}/bookable/${event.id}`, action: 'Book Now' as const, date: session.startsAt }] : []
    })
  const catalogue = listings.filter(listing => listing.kind.toLowerCase() === category).map(listing => ({
    id: listing.id, title: catalogueText(listing.title), image: experiencePhoto(category, listing.imageUrl, listing.id),
    href: `/${category}/${listing.id}`, action: 'Explore' as const,
  }))
  return [...inventory, ...catalogue].slice(0, 6)
}
