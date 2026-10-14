import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router'
import { eventsApi } from '../api/events'
import type { EventKind, EventSummary } from '../api/event-types'
import { useAsync } from '../app/use-async'
import { usePagedAsync } from '../app/use-paged-async'
import { ScrollMore } from '../components/ScrollMore'
import { useCity } from '../app/city-context'
import { EmptyState, ErrorState, Loading } from '../components/feedback'
import { EventArtwork } from '../components/EventArtwork'
import { LocationDialog } from '../components/LocationDialog'
import { LocationPin } from '../components/LocationPin'
import { formatDateTime, money } from '../domain/time'
import { getServerNow } from '../api/client'

export function EventPage({ kind }: { kind: EventKind }) {
  const { id = '' } = useParams(), city = useCity()
  const load = useCallback((signal: AbortSignal) => eventsApi.get(id, signal), [id])
  const resource = useAsync(`event:${id}`, load)
  return <main className="page-shell event-detail"><Link className="listing-back" to={`/${kind.toLowerCase()}`}>← Back to {kind.toLowerCase()}</Link>
    {resource.loading ? <Loading label="Loading experience…" /> : resource.error ? <ErrorState error={resource.error} retry={resource.reload} /> : resource.data!.event.kind !== kind ? <EmptyState title="Experience not found" detail="This experience belongs to another category." /> : <>
      <EventIntro event={resource.data!.event} />
      {city.loading ? <Loading label="Loading your location…" /> : city.error ? <ErrorState error={city.error} retry={city.retry} /> : <EventSessions key={`${id}:${city.cityId}`} event={resource.data!.event} cityId={city.cityId} />}
    </>}
  </main>
}
function EventIntro({ event }: { event: EventSummary }) {
  return <><section className="panel event-feature"><EventArtwork key={event.id} event={event} className="event-feature-art" /><div className="event-feature-copy"><p className="eyebrow">{event.kind} {event.sport && `· ${event.sport}`}</p>
    <h1>{event.title}</h1><p className="event-duration">Reserved numbered seats · {event.durationMinutes} min · Times in IST</p>
    <a className="btn" href="#event-sessions">Explore sessions <span aria-hidden="true">↘</span></a></div></section>
    {event.performers.length > 0 && <section className="event-people"><h2>Meet the performers</h2><div>{event.performers.map(person => <article className="panel" key={person.name}><span className="performer-monogram" aria-hidden="true">{person.name.slice(0, 1)}</span><h3>{person.name}</h3></article>)}</div></section>}
    {event.participants.length > 0 && <section className="event-people"><h2>On the playing field</h2><div>{event.participants.map(person => <article className="panel" key={person.name}><h3>{person.name}</h3></article>)}</div></section>}
  </>
}
function EventSessions({ event, cityId }: { event: EventSummary; cityId: string }) {
  const [page, setPage] = useState(1), [picker, setPicker] = useState(false), city = useCity()
  const load = useCallback((signal: AbortSignal) => eventsApi.sessions({ eventId: event.id, cityId: cityId || undefined, page, limit: 20 }, signal), [event.id, cityId, page])
  const resource = usePagedAsync(`event-sessions:${event.id}:${cityId}`, load, page, 30000)
  return <section id="event-sessions" className="event-sessions" aria-labelledby="event-session-title"><div className="section-heading"><div><p className="eyebrow">YOUR NEXT EXPERIENCE</p><h2 id="event-session-title">Find your session</h2><p>Choose a venue and time. All times in IST.</p></div><button className="secondary" onClick={() => setPicker(true)}><LocationPin />{city.selectedCity?.name ?? 'All cities'}</button></div>
    {resource.loading ? <Loading label="Loading sessions…" /> : resource.error ? <ErrorState error={resource.error} retry={resource.reload} /> : !resource.data!.items.length ? <EmptyState title="No upcoming sessions" detail="Tickets are unavailable for this experience in your selected city. Try another supported city." /> : <div className="event-session-list">{resource.data!.items.map(session => {
      const bookable = session.eventId === event.id && session.event.kind === event.kind && session.status === 'SCHEDULED' && Date.parse(session.startsAt) > getServerNow() && session.prices.length > 0
      return <article className="panel event-session-card" key={session.id}><div className="session-date"><span>{new Intl.DateTimeFormat('en-GB', { day: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(session.startsAt))}</span><small>{new Intl.DateTimeFormat('en-GB', { month: 'short', weekday: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(session.startsAt))}</small></div><div className="session-copy"><h3>{session.venue.name.replace(/^CineHook\s+(Sample|Demo)\s+/i, '')}</h3><p>{session.venue.city.name} · {formatDateTime(session.startsAt)}</p><div className="event-tier-prices">{session.prices.map(price => <span key={price.ticketTier}>{price.ticketTier} <strong>{money(price.pricePaise)}</strong></span>)}</div></div>{bookable ? <Link className="btn" to={`/event-sessions/${session.id}/seats`} aria-label={`Choose seats · ${session.venue.name.replace(/^CineHook\s+(Sample|Demo)\s+/i, '')} · ${formatDateTime(session.startsAt)}`}>Choose seats →</Link> : <button className="secondary" disabled>Tickets unavailable</button>}</article>
    })}</div>}
    <ScrollMore {...resource} next={() => setPage(p => p + 1)} retry={resource.reload}/>
    {picker && <LocationDialog onClose={() => setPicker(false)} />}
  </section>
}
