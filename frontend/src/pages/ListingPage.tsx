import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router'
import { demoCatalogApi, type DemoKind, type DemoListing } from '../api/demo-catalog'
import { useAsync } from '../app/use-async'
import { useCity } from '../app/city-context'
import { ErrorState, Loading } from '../components/feedback'
import { ThematicArt } from '../components/ThematicArt'
import { LocationPin } from '../components/LocationPin'
import { LocationDialog } from '../components/LocationDialog'
import { formatDateTime } from '../domain/time'
import { experiencePhoto } from '../domain/experience-media'

const names = { stream: 'Stream', events: 'Events', sports: 'Sports', activities: 'Activities' }
const cleanLabel = (value: string) => value.replace(/\s*[—-]\s*DEMO\b/gi, '').replace(/\b(Demo|Sample)\s*/gi, '').trim()
export function ListingPage({ category }: { category: DemoKind }) {
  const { id = '' } = useParams()
  const load = useCallback((signal: AbortSignal) => demoCatalogApi.get(category, id, signal), [category, id])
  const resource = useAsync(`listing:${category}:${id}`, load)
  return <main className="page-shell listing-detail"><Link className="listing-back" to={`/${category}`}><span aria-hidden="true">←&nbsp;</span>Back to {names[category]}</Link>
    {resource.loading ? <Loading label="Loading experience…"/> : resource.error ? <ErrorState error={resource.error} retry={resource.reload}/> : <ListingContent key={resource.data!.listing.id} listing={resource.data!.listing}/>}
  </main>
}
function ListingContent({ listing }: { listing: DemoListing }) {
  const city = useCity(), [failed, setFailed] = useState(false), [picker, setPicker] = useState(false)
  const selectedCity = city.selectedCity?.name
  const differentCity = selectedCity && listing.cityName && selectedCity.toLowerCase() !== listing.cityName.toLowerCase()
  const stream = listing.kind === 'STREAM'
  return <>
    <section className="panel listing-feature"><div className="listing-detail-art">{failed ? <ThematicArt theme="cinema"/> : <img src={experiencePhoto(listing.kind, listing.imageUrl, listing.id)} alt={`${listing.title.replace(/\s*[—-]\s*DEMO\b/gi, "")} banner`} fetchPriority="high" onError={() => setFailed(true)}/>}</div>
      <div className="listing-feature-copy"><p className="eyebrow">{listing.category}</p><h1>{cleanLabel(listing.title)}</h1>
        <div className="listing-facts"><dl>{listing.cityName && <div><dt>City</dt><dd>{listing.cityName}</dd></div>}{listing.venueName && <div><dt>Venue</dt><dd>{cleanLabel(listing.venueName)}</dd></div>}{listing.startsAt && <div><dt>Date · IST</dt><dd>{formatDateTime(listing.startsAt)}</dd></div>}{listing.durationMinutes && <div><dt>Duration</dt><dd>{listing.durationMinutes} min</dd></div>}</dl></div>
        <button className="secondary listing-city" onClick={() => setPicker(true)}><LocationPin/><span>Selected city: {city.loading ? 'Loading cities…' : city.error ? 'Location unavailable' : selectedCity ?? 'All cities'}</span></button>
        {differentCity && <p className="muted listing-city-note">This experience is listed in {listing.cityName}, outside your selected city. Change location to browse that city.</p>}
      </div></section>
    <section className="panel listing-availability" aria-labelledby="listing-availability-title"><div><h2 id="listing-availability-title">Coming soon</h2><p className="muted">{stream ? 'Streaming will be available in a future update.' : 'Booking is not available for this experience yet.'}</p></div><button className="btn" disabled>Coming soon</button></section>
    {picker && <LocationDialog onClose={() => setPicker(false)}/>}
  </>
}
