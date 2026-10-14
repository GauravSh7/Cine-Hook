import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ThematicArt } from '../components/ThematicArt'
import { demoCatalogApi, type DemoKind, type DemoListing } from '../api/demo-catalog'
import { usePagedAsync } from '../app/use-paged-async'
import { ScrollMore } from '../components/ScrollMore'
import { EmptyState, ErrorState, Loading } from '../components/feedback'
import { useCity } from '../app/city-context'
import { eventsApi } from '../api/events'
import type { EventKind, EventSummary } from '../api/event-types'
import { EventArtwork } from '../components/EventArtwork'
import { money } from '../domain/time'
import { experiencePhoto } from '../domain/experience-media'
import { useNow } from '../app/use-now'
import { CategoryFeaturedCarousel } from '../components/CategoryFeaturedCarousel'
import { catalogueText, categorySlides } from '../components/category-carousel-data'

const data = {
  stream: { title: 'Stories beyond the big screen', subtitle: 'Find your next story.', groups: ['Drama', 'Romance', 'Thriller', 'Comedy', 'Sci-Fi', 'Adventure'] },
  events: { title: 'Music. Moments. Memories.', subtitle: 'Discover a world of live experiences', groups: ['Concerts', 'Comedy Shows', 'Theatre & Performing Arts', 'Exhibitions', 'Festivals'] },
  sports: { title: 'Live sports. Feel the action.', subtitle: 'The thrill of the game, all in one place', groups: ['Cricket', 'Football', 'Badminton & Indoor', 'Other Sports'] },
  activities: { title: 'Unlock new experiences', subtitle: 'Learn. Play. Explore. Together.', groups: ['Workshops', 'Gaming & VR', 'Adventure & Fun', 'Kids Activities', 'Weekend Experiences'] },
}
export function CategoryPage({ category }: { category: keyof typeof data }) {
  const city = useCity()
  if (city.loading) return <main className="page-shell"><Loading label="Loading your location…"/></main>
  if (city.error) return <main className="page-shell"><ErrorState error={city.error} retry={city.retry}/></main>
  return <DemoCatalogue key={`${category}:${city.cityId}`} category={category} cityId={city.cityId} />
}
function DemoCatalogue({ category, cityId }: { category: DemoKind; cityId: string }) {
  const content = data[category], [selected, setSelected] = useState(''), [search, setSearch] = useState(''), [draft, setDraft] = useState(''), [page, setPage] = useState(1)
  const now = useNow()
  const load = useCallback((signal: AbortSignal) => demoCatalogApi.list(category, { cityId: cityId || undefined, category: selected || undefined, search: search || undefined, page, limit: 12 }, signal), [category, cityId, selected, search, page])
  const listings = usePagedAsync(`demo:${category}:${cityId}:${selected}:${search}`, load, page)
  const [featuredEvents, setFeaturedEvents] = useState<EventSummary[]>([])
  const updateFeaturedEvents = useCallback((events: EventSummary[]) => setFeaturedEvents(previous => previous.length === events.length && previous.every((event, index) => event === events[index]) ? previous : events), [])
  const submit = (event: FormEvent) => { event.preventDefault(); setSearch(draft.trim()); setPage(1) }
  return <main className={`page-shell category-page category-${category} demo-catalogue`}><CategoryFeaturedCarousel category={category} title={content.title} slides={categorySlides(category, listings.data?.items ?? [], featuredEvents, cityId, now)} />
    {category !== 'stream' && <BookableCatalogue key={`${category}:${cityId}:${search}`} kind={category.toUpperCase() as EventKind} cityId={cityId} search={search} onFeatured={updateFeaturedEvents} />}
    <section className="demo-discovery" id="category-explore"><div className="section-heading"><div><h2>Explore {category}</h2></div></div><div className="filter-tabs" role="group" aria-label="Experience categories">{['All', ...content.groups].map(group => <button key={group} className={selected === (group === 'All' ? '' : group) ? 'btn' : 'secondary'} aria-pressed={selected === (group === 'All' ? '' : group)} onClick={() => { setSelected(group === 'All' ? '' : group); setPage(1) }}>{group}</button>)}</div><form className="demo-search" onSubmit={submit}><label>Search experiences<input className="input" type="search" value={draft} onChange={event => setDraft(event.target.value)} maxLength={100} placeholder="Find a story, sport or experience" /></label><button className="btn" type="submit">Find listings</button><button className="secondary" type="button" onClick={() => { setSelected(''); setSearch(''); setDraft(''); setPage(1) }}>Clear filters</button></form></section>
    {listings.loading ? <Loading label="Loading experiences…" /> : listings.error ? <ErrorState error={listings.error} retry={listings.reload} /> : listings.data!.items.length === 0 ? <EmptyState title="No experiences found" detail="Try another city or category, or clear your filters." /> : <div className="demo-listing-grid">{listings.data!.items.map((listing, index) => <DemoCard key={listing.id} listing={listing} variation={index % 3} />)}</div>}
    <ScrollMore {...listings} next={() => setPage(p => p + 1)} retry={listings.reload}/>
  </main>
}
function BookableCatalogue({ kind, cityId, search, onFeatured }: { kind: EventKind; cityId: string; search: string; onFeatured: (events:EventSummary[])=>void }) {
  const [page, setPage] = useState(1)
  const load = useCallback((signal: AbortSignal) => eventsApi.list({ kind, cityId: cityId || undefined, search: search || undefined, page, limit: 12 }, signal), [kind, cityId, search, page])
  const resource = usePagedAsync(`inventory:${kind}:${cityId}:${search}`, load, page)
  useEffect(() => { onFeatured(resource.loading || resource.error ? [] : resource.data?.items ?? []) }, [resource.data, resource.loading, resource.error, onFeatured])
  return <section className="bookable-discovery" aria-labelledby="bookable-title"><div className="section-heading"><div><h2 id="bookable-title">Book an experience</h2></div></div>
    {resource.loading ? <p className="muted" aria-live="polite">Loading experiences…</p> : resource.error ? <ErrorState error={resource.error} retry={resource.reload} /> : !resource.data!.items.length ? <p className="muted">No sessions found. Try another city or search.</p> : <div className="demo-listing-grid">{resource.data!.items.filter(item => item.kind === kind).map(event => <EventCard key={event.id} event={event} />)}</div>}
    <ScrollMore {...resource} next={() => setPage(p => p + 1)} retry={resource.reload}/>
  </section>
}
function EventCard({ event }: { event: EventSummary }) {
  const prices = event.sessions.flatMap(session => session.prices.map(price => price.pricePaise)), cities = [...new Set(event.sessions.map(session => session.venue.city.name))]
  return <article className="panel demo-listing event-listing"><Link className="listing-card-link" to={`/${event.kind.toLowerCase()}/bookable/${event.id}`} aria-label={`Book ${catalogueText(event.title)}`}><div className="demo-listing-art"><EventArtwork event={event} /></div><div className="demo-listing-copy"><p className="eyebrow">{event.kind}{event.sport && ` · ${catalogueText(event.sport)}`}</p><h2>{catalogueText(event.title)}</h2><dl><dt>City</dt><dd>{cities.join(' · ')}</dd>{prices.length > 0 && <><dt>Tickets</dt><dd>From {money(Math.min(...prices))} / seat</dd></>}</dl><span className="listing-card-action">Book Now <span aria-hidden="true">→</span></span></div></Link></article>
}
function DemoCard({ listing, variation }: { listing: DemoListing; variation: number }) {
  const [failed, setFailed] = useState(false)
  return <article className={`demo-listing panel demo-variation-${variation}`}><Link className="listing-card-link" to={`/${listing.kind.toLowerCase()}/${listing.id}`} aria-label={`Open ${catalogueText(listing.title)}`}><div className="demo-listing-art">{!failed ? <img src={experiencePhoto(listing.kind, listing.imageUrl, listing.id)} alt={`${catalogueText(listing.title)} banner`} loading="lazy" onError={() => setFailed(true)} /> : <ThematicArt theme="cinema" />}</div><div className="demo-listing-copy"><p className="eyebrow">{catalogueText(listing.category)}</p><h2>{catalogueText(listing.title)}</h2><dl>{listing.cityName && <><dt>City</dt><dd>{listing.cityName}</dd></>}{listing.venueName && <><dt>Venue</dt><dd>{catalogueText(listing.venueName)}</dd></>}</dl><span className="listing-card-action">Explore <span aria-hidden="true">→</span></span></div></Link></article>
}
