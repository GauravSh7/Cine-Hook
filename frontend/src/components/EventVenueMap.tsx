import { useId, useState, type CSSProperties } from 'react'
import type { EventAvailabilitySeat, EventSection, EventSessionDetail } from '../api/event-types'
import { money } from '../domain/time'

interface Props { session: EventSessionDetail; seats: EventAvailabilitySeat[]; selected: string[]; disabled: boolean; onToggle: (id: string) => void }
export function EventVenueMap({ session, seats, selected, disabled, onToggle }: Props) {
  const [zoom, setZoom] = useState(1)
  const auditorium = session.venue.kind === 'AUDITORIUM'
  const sections = [...session.venue.sections].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  const renderSection = (section: EventSection) => <VenueSection key={section.id} section={section} seats={seats} selected={selected} disabled={disabled} onToggle={onToggle} />
  const positions = ['NORTH', 'SOUTH', 'EAST', 'WEST']
  return <section className={`event-map-panel panel venue-atmosphere ${auditorium ? 'atmosphere-stage' : 'atmosphere-sports'}`} aria-labelledby="venue-map-title"><div className="event-map-toolbar"><div><h2 id="venue-map-title">{auditorium ? 'Find your view of the stage' : 'Choose your stand'}</h2><p className="muted">Section, row and number identify every seat.</p></div><div className="map-zoom" role="group" aria-label="Seat map zoom"><button className="secondary" aria-label="Zoom out" disabled={zoom === 1} onClick={() => setZoom(value => Math.max(1, value - .25))}>−</button><button className="secondary" aria-label="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button className="secondary" aria-label="Zoom in" disabled={zoom === 1.75} onClick={() => setZoom(value => Math.min(1.75, value + .25))}>+</button></div></div>
    <p className="map-scroll-hint" id="event-map-help">Swipe or scroll inside the map to explore. Use zoom for a closer view. Keyboard: Tab to a seat, then Enter or Space to select.</p>
    <div className="event-map-viewport" role="region" aria-label="Venue seat map, scrollable" aria-describedby="event-map-help" tabIndex={0}>
      <div className={`event-venue-map ${auditorium ? 'venue-auditorium' : 'venue-stadium'}`} style={{ '--map-zoom': zoom } as CSSProperties}>
        {auditorium ? <><div className="venue-stage"><Stage workshop={session.event.kind === 'ACTIVITIES'} /><span>{session.event.kind === 'ACTIVITIES' ? 'FRONT · ACTIVITY AREA' : 'FRONT · STAGE'}</span></div><div className="auditorium-sections">{sections.map(renderSection)}</div></> : <>
          <Floodlights /><div className="stadium-track" aria-hidden="true" />
          <div className="stand-north">{sections.filter(section => section.position === 'NORTH').map(renderSection)}</div>
          <div className="stand-west">{sections.filter(section => section.position === 'WEST').map(renderSection)}</div>
          <div className="venue-ground"><PlayingArea sport={session.event.sport} /></div>
          <div className="stand-east">{sections.filter(section => section.position === 'EAST').map(renderSection)}</div>
          <div className="stand-south">{sections.filter(section => section.position === 'SOUTH').map(renderSection)}</div>
          <div className="stand-other">{sections.filter(section => !positions.includes(section.position)).map(renderSection)}</div>
        </>}
      </div>
    </div><ul className="event-seat-legend" aria-label="Seat states"><li><i className="legend-available" aria-hidden="true" />Available</li><li><i className="legend-selected" aria-hidden="true" />Selected</li><li><i className="legend-booked" aria-hidden="true" />Unavailable</li></ul>
  </section>
}
function Floodlights() {
  const id = useId()
  return <svg className="stadium-floodlights" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id={id} x2="0" y2="1"><stop stopColor="#d6eeff" stopOpacity=".24" /><stop offset="1" stopColor="#b5eeff" stopOpacity="0" /></linearGradient></defs>{[false, true].map(right => <g key={String(right)} transform={right ? 'translate(1000 0) scale(-1 1)' : undefined}><path d="M75 68 400 490H90z" fill={`url(#${id})`} /><path d="M60 80v122m25-122v122M60 110l25 25-25 25 25 25" fill="none" stroke="#517488" strokeWidth="4" /><rect x="30" y="44" width="90" height="40" rx="6" fill="#203c50" stroke="#8eafc2" strokeWidth="2" />{[0, 1, 2, 3, 4].map(column => <g key={column}><rect x={37 + column * 16} y="51" width="11" height="10" rx="2" fill="#edf9ff" /><rect x={37 + column * 16} y="67" width="11" height="10" rx="2" fill="#cfebff" /></g>)}</g>)}</svg>
}
function VenueSection({ section, seats, selected, disabled, onToggle }: Omit<Props, 'session'> & { section: EventSection }) {
  const rows = [...new Set(section.seats.map(seat => seat.rowName))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const tiers = [...new Set(section.seats.map(seat => seat.ticketTier))]
  return <section className={`venue-section venue-section-${section.position.toLowerCase()}`} aria-label={`${section.name} seats`}><div className="venue-section-heading"><h3>{section.name}</h3><p>{section.code} · {tiers.join(' / ')}</p></div><div className="venue-section-rows">{rows.map(row => <div className="venue-seat-row" key={row}><span className="venue-row-label">{row}</span><div>{section.seats.filter(seat => seat.rowName === row).sort((a, b) => a.seatNumber - b.seatNumber).map(physical => {
    const seat = seats.find(item => item.id === physical.id && item.sectionId === section.id && item.rowName === physical.rowName && item.seatNumber === physical.seatNumber && item.ticketTier === physical.ticketTier)
    const state = seat?.availability.toLowerCase() ?? 'unknown', chosen = !!seat && selected.includes(seat.id)
    return <button key={physical.id} type="button" className={`event-seat event-seat-${state}${chosen ? ' event-seat-selected' : ''}`} disabled={disabled || !seat || seat.availability !== 'AVAILABLE'} aria-pressed={chosen}
      aria-label={`${section.name} (${section.code}) ${physical.rowName}${physical.seatNumber} ${seat ? state === 'locked' ? 'unavailable' : state : 'unavailable'} ${physical.ticketTier} ${seat ? money(seat.pricePaise) : 'price unavailable'}`}
      onClick={() => onToggle(physical.id)}><span>{physical.rowName}{physical.seatNumber}</span>{chosen && <b aria-hidden="true">✓</b>}</button>
  })}</div></div>)}</div></section>
}
function Stage({ workshop }: { workshop: boolean }) {
  return <svg viewBox="0 0 600 190" role="img" aria-label={workshop ? 'Front activity stage' : 'Stage with standing performer and microphone'}><defs><linearGradient id="event-stage-light" x2="0" y2="1"><stop stopColor="#874a70" /><stop offset="1" stopColor="#201b31" /></linearGradient></defs><path d="M25 15h550v148H25z" fill="url(#event-stage-light)" /><path d="M25 15h68l-20 148H25zM507 15h68v148h-49z" fill="#a63257" /><path d="m150 15 80 150h-130zm300 0 50 150H370z" fill="#f8ce9c" opacity=".1" /><path d="M10 163h580v17H10z" fill="#74546b" /><path d="M10 180h580v10H10z" fill="#282336" />
    {workshop ? <><path d="M245 116h110v8H245zm10 8v39m90-39v39" stroke="#dbc6b1" strokeWidth="5" /><path d="m281 96 20-15 20 15-20 14z" fill="#e3c08b" /></> : <><circle cx="286" cy="48" r="14" fill="#f2c7a1" /><path d="M269 67q17-9 34 0l10 56h-56z" fill="#302945" /><path d="m274 122-4 39m27-39 8 39" stroke="#e7e0e4" strokeWidth="9" /><path d="m304 76 23 19 19-9" fill="none" stroke="#f2c7a1" strokeWidth="7" strokeLinecap="round" /><path d="M350 80v83m-13 0h26" stroke="#c0b7d7" strokeWidth="3" /><path d="m344 76 13-2" stroke="#f3d4d6" strokeWidth="7" strokeLinecap="round" /></>}
  </svg>
}
function PlayingArea({ sport }: { sport: string | null }) {
  const value = sport?.toLowerCase()
  if (value === 'cricket') return <svg viewBox="0 0 500 350" role="img" aria-label="Cricket field with central pitch"><ellipse cx="250" cy="175" rx="232" ry="155" fill="#235849" stroke="#aac8a0" strokeWidth="4" /><ellipse cx="250" cy="175" rx="165" ry="105" fill="none" stroke="#dae3b6" strokeWidth="2" strokeDasharray="9 9" /><rect x="226" y="110" width="48" height="130" rx="5" fill="#c9b185" /><path d="M230 123h40m-40 104h40" stroke="#fff5d6" strokeWidth="3" /><path d="M246 111v13m4-13v13m4-13v13m-8 102v13m4-13v13m4-13v13" stroke="#423b26" strokeWidth="2" /><text x="250" y="290" textAnchor="middle" fill="#d6e7d3">CRICKET · PLAYING AREA</text></svg>
  if (value === 'football') return <svg viewBox="0 0 500 350" role="img" aria-label="Football field with goals and halfway line"><rect x="20" y="25" width="460" height="300" rx="12" fill="#235849" />{[0, 2, 4, 6].map(index => <rect key={index} x={30 + index * 55} y="35" width="55" height="280" fill="#2e6450" />)}<g fill="none" stroke="#d7e5d1" strokeWidth="3"><path d="M35 40h430v270H35zM250 40v270M35 100h65v150H35m430-150h-65v150h65M35 140h25v70H35m430-70h-25v70h25" /><circle cx="250" cy="175" r="43" /><path d="M100 144q32 31 0 62m300-62q-32 31 0 62M20 152h15v46H20zm445 0h15v46h-15z" /></g><circle cx="250" cy="175" r="4" fill="#d7e5d1" /><text x="250" y="295" textAnchor="middle" fill="#e1ecda">FOOTBALL · PLAYING AREA</text></svg>
  if (value === 'basketball') return <svg viewBox="0 0 500 350" role="img" aria-label="Basketball court with hoops and key markings"><rect x="20" y="25" width="460" height="300" rx="14" fill="#966a48" /><g fill="none" stroke="#f6e3c5" strokeWidth="3"><path d="M35 40h430v270H35zM250 40v270M35 125h100v100H35m430-100H365v100h100" /><circle cx="250" cy="175" r="40" /><path d="M135 125a50 50 0 0 1 0 100m230-100a50 50 0 0 0 0 100M35 65q195 110 0 220m430-220q-195 110 0 220M57 160v30m386-30v30" /><circle cx="67" cy="175" r="8" /><circle cx="433" cy="175" r="8" /></g><text x="250" y="292" textAnchor="middle" fill="#ffeed5">BASKETBALL · COURT</text></svg>
  return <svg viewBox="0 0 500 350" role="img" aria-label="Court"><rect x="20" y="25" width="460" height="300" rx="14" fill="#29655c" /><g fill="none" stroke="#deefe6" strokeWidth="3"><path d="M40 45h420v260H40zM250 45v260" /><rect x="95" y="85" width="310" height="180" /><path d="M95 175h310" strokeDasharray="5 5" /></g><text x="250" y="290" textAnchor="middle" fill="#deefe6">COURT</text></svg>
}
