import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router'
import { catalogApi } from '../api/catalog'
import { useCity } from '../app/city-context'
import { useAsync } from '../app/use-async'
import { usePagedAsync } from '../app/use-paged-async'
import { ScrollMore } from '../components/ScrollMore'
import { Poster } from '../components/MovieCard'
import { LocationDialog } from '../components/LocationDialog'
import { EmptyState, ErrorState, Loading } from '../components/feedback'
import { formatDateTime } from '../domain/time'
import { WishlistButton } from '../components/WishlistButton'
import { TrailerDialog } from '../components/TrailerDialog'
import { hasTrustedTrailer } from '../domain/movie-media'
import { publicVenueLabel } from '../domain/customer-copy'

export function MoviePage() {
  const { id = '' } = useParams(), city = useCity()
  if (city.loading) return <main className="page-shell"><Loading label="Loading your location…" /></main>
  if (city.error) return <main className="page-shell"><ErrorState error={city.error} retry={city.retry} /></main>
  return <MovieDetails key={`${id}:${city.cityId}`} id={id} />
}
function MovieDetails({ id }: { id: string }) {
  const { cityId, selectedCity } = useCity(), [date, setDate] = useState(''), [page, setPage] = useState(1), [picker, setPicker] = useState(false)
  const load = useCallback((signal: AbortSignal) => catalogApi.movie(id, signal, cityId || undefined), [id, cityId])
  const movie = useAsync(`movie:${id}:${cityId}`, load)
  const dateLoad = useCallback((signal: AbortSignal) => catalogApi.showDates(id, cityId || undefined, signal), [id, cityId])
  const dates = useAsync(`dates:${id}:${cityId}`, dateLoad)
  const showLoad = useCallback((signal: AbortSignal) => catalogApi.shows({ movieId: id, cityId: cityId || undefined, localDate: date || undefined, page }, signal), [id, cityId, date, page])
  const shows = usePagedAsync(`shows:${id}:${cityId}:${date}`, showLoad, page, 30000)
  if (movie.loading) return <main className="page-shell"><Loading label="Loading movie…" /></main>
  if (movie.error) return <main className="page-shell"><ErrorState error={movie.error} retry={movie.reload} /></main>
  const detail = movie.data!.movie
  const groups = new Map<string, NonNullable<typeof shows.data>['items']>()
  for (const show of shows.data?.items ?? []) { const key = show.screen.theatre.id; groups.set(key, [...(groups.get(key) ?? []), show]) }
  const rating = detail.rating
  return <main className="page-shell movie-detail">
    <section className="detail-feature"><Poster movie={detail} backdrop className="detail-backdrop" /><div className="detail-shade" /><Poster movie={detail} className="detail-poster" /><div className="detail-copy"><p className="eyebrow">ON THE BIG SCREEN</p><h1>{detail.title}</h1><p className="detail-metadata">{detail.language} <span>•</span> {detail.durationMinutes} min <span>•</span> {new Date(detail.releaseDate).getUTCFullYear()}</p><p className="detail-genres">{detail.genres.join(' / ')}</p><p className="detail-synopsis" lang="en">{detail.description}</p>{detail.descriptionHindi && <p className="detail-synopsis hindi-synopsis" lang="hi">{detail.descriptionHindi}</p>}<MovieTrailer movie={detail} />
      {rating && <p className="rating-note"><a href={rating.sourceUrl} target="_blank" rel="noopener noreferrer">★ {rating.value.toFixed(1)}/{rating.scale} · {rating.provider} · {rating.voteCount.toLocaleString()} votes</a></p>}<WishlistButton movieId={detail.id} /></div>
    </section>
    <section className="show-selection"><div className="section-heading"><div><h2>Make it a movie night.</h2><p>Choose a date and showtime · All times in IST.</p></div><button className="secondary" onClick={() => setPicker(true)}>{selectedCity?.name ?? 'All cities'} <span aria-hidden="true">⌄</span></button></div>
      <h2 className="text-lg font-semibold">Select date</h2>
      {dates.loading ? <Loading label="Loading show dates…" /> : dates.error ? <ErrorState error={dates.error} retry={dates.reload} /> : <div className="date-strip" role="group" aria-label="Show dates in IST"><button className={date ? 'secondary' : 'btn'} aria-pressed={!date} onClick={() => { setDate(''); setPage(1) }}>All dates</button>{dates.data!.dates.map(value => <button key={value} className={date === value ? 'btn' : 'secondary'} aria-pressed={date === value} onClick={() => { setDate(value); setPage(1) }}><span>{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(`${value}T12:00:00+05:30`))}</span><small>{new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(`${value}T12:00:00+05:30`))}</small></button>)}</div>}
      <div className="show-groups" aria-label="Available shows">{shows.loading ? <Loading label="Loading shows…" /> : shows.error ? <ErrorState error={shows.error} retry={shows.reload} /> : groups.size === 0 ? <EmptyState title="No scheduled shows" detail="There are no screenings for this movie in the selected city and date. Try another date or city." /> : [...groups.values()].map(items => <section key={items[0]!.screen.theatre.id} className="panel theatre-shows"><div><h3>{publicVenueLabel(items[0]!.screen.theatre.name)}</h3><p className="muted text-sm">{items[0]!.screen.theatre.city.name}</p></div><div className="showtime-list">{items.map(show => show.status === 'SCHEDULED' && new Date(show.startsAt).getTime() > Date.now() ? <Link key={show.id} className="secondary showtime" to={`/shows/${show.id}/seats`}>{formatDateTime(show.startsAt)}<small>{publicVenueLabel(show.screen.name)}</small></Link> : <button key={show.id} disabled className="secondary showtime">{formatDateTime(show.startsAt)}<small>No longer available</small></button>)}</div></section>)}</div>
      <ScrollMore {...shows} next={() => setPage(p => p + 1)} retry={shows.reload}/>
    </section>{picker && <LocationDialog onClose={() => setPicker(false)} />}
  </main>
}
function MovieTrailer({ movie }: { movie: import('../api/types').Movie }) {
  const [open, setOpen] = useState(false)
  return <div className="movie-trailer-action">{hasTrustedTrailer(movie) ? <button className="btn" onClick={() => setOpen(true)}>Play Trailer</button> : <span className="secondary" aria-disabled="true">Trailer unavailable</span>}{open && <TrailerDialog movie={movie} onClose={() => setOpen(false)} />}</div>
}
