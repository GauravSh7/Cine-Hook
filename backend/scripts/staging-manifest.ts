import { createHash } from 'node:crypto';
import { FILMS, VENUES, SEAT_LAYOUT, SEAT_PRICES } from '../prisma/dev-seed-manifest.js';
import { EVENT_SAMPLES } from '../prisma/event-seed-manifest.js';
import { DEMO_LISTINGS, HINDI_SUMMARIES } from '../prisma/refinement-manifest.js';

export type ImportRow = Record<string, unknown>;
export type CatalogueModel = 'city' | 'movie' | 'theatre' | 'screen' | 'seat' | 'show' | 'showSeatPrice' | 'event' | 'eventPerformer' | 'eventParticipant' | 'eventVenue' | 'eventSection' | 'eventSeat' | 'eventSession' | 'eventSessionPrice' | 'demoListing';
export type CatalogueGroup = { model: CatalogueModel; keys: string[]; identity: string[]; immutable: string[]; rows: ImportRow[] };
export function stagingId(key: string): string {
  const hex = createHash('sha256').update(`cinehook:staging-catalogue:v1:${key}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export function nextStagingDate(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60000 + 86400000).toISOString().slice(0,10);
}
export function stagingManifest(startDate: string): CatalogueGroup[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || new Date(startDate + 'T00:00:00Z').toISOString().slice(0,10) !== startDate) throw new Error('Invalid staging start date.');
  const groups: CatalogueGroup[] = [];
  const add = (model: CatalogueModel, identity: string[], immutable: string[], keys = ['id']) => {
    const group: CatalogueGroup = { model, keys, identity, immutable, rows: [] }; groups.push(group); return group.rows;
  };
  const cities = add('city', ['countryCode','state','name'], ['countryCode','state','name']);
  const movies = add('movie', ['title','language','releaseDate'], ['title','language','releaseDate']);
  const theatres = add('theatre', ['cityId','name'], ['cityId','name']);
  const screens = add('screen', ['theatreId','name'], ['theatreId','name','capacity']);
  const seats = add('seat', ['screenId','rowName','seatNumber'], ['screenId','rowName','seatNumber','seatType']);
  const shows = add('show', ['screenId','startsAt'], ['movieId','screenId','startsAt']);
  const showPrices = add('showSeatPrice', ['showId','seatType'], ['showId','seatType'], ['showId','seatType']);
  const events = add('event', ['slug'], ['slug','kind','sport']);
  const performers = add('eventPerformer', ['eventId','name'], ['eventId','name'], ['eventId','name']);
  const participants = add('eventParticipant', ['eventId','name'], ['eventId','name'], ['eventId','name']);
  const venues = add('eventVenue', ['cityId','name'], ['cityId','name','kind','capacity']);
  const sections = add('eventSection', ['venueId','code'], ['venueId','code','position','sortOrder']);
  const eventSeats = add('eventSeat', ['sectionId','rowName','seatNumber'], ['sectionId','rowName','seatNumber','ticketTier']);
  const sessions = add('eventSession', ['venueId','startsAt'], ['eventId','venueId','startsAt']);
  const eventPrices = add('eventSessionPrice', ['sessionId','ticketTier'], ['sessionId','ticketTier'], ['sessionId','ticketTier']);
  const listings = add('demoListing', ['slug'], ['slug','kind']);
  for (const film of FILMS) movies.push({ id: stagingId(`movie:${film.key}`), title: film.title, description: film.description,
    descriptionHindi: HINDI_SUMMARIES[film.key] ?? null, durationMinutes: film.durationMinutes, releaseDate: new Date(film.releaseDate + 'T00:00:00Z'),
    language: film.language, genres: [...film.genres], collections: [...film.collections], isActive: true,
    posterUrl: `/demo-art/${film.key}-poster.svg`, backdropUrl: `/demo-art/${film.key}-backdrop.svg`, metadataSourceUrl: film.sourceUrl,
    artworkKind: 'ILLUSTRATION', artworkAttribution: 'Original CineHook artwork, CC0 1.0; not official film artwork.',
    // Existing illustration provenance constraint keeps source URL null; the CC0 licence is documented with the bundled assets.
    artworkSourceUrl: null, ratingValue: null, ratingVoteCount: null, ratingSource: null,
    ratingSourceUrl: null, ratingFetchedAt: null });
  const days = Array.from({ length: 7 }, (_, index) => new Date(new Date(startDate + 'T00:00:00Z').getTime() + index * 86400000));
  for (const venue of VENUES) {
    const cityId = stagingId(`city:${venue.key}`), theatreId = stagingId(`theatre:${venue.key}`);
    cities.push({ id: cityId, name: venue.name, state: venue.state, countryCode: venue.countryCode });
    theatres.push({ id: theatreId, cityId, name: `CineHook Showcase ${venue.name}`, address: `Fictional portfolio screening venue in ${venue.name}. No real cinema tickets are sold.` });
    for (let index = 0; index < 2; index++) {
      const screenId = stagingId(`screen:${venue.key}:${index}`);
      const layout = index === 0 ? [...SEAT_LAYOUT] : 'ABCDEFGHIJKL'.split('').flatMap((rowName, row) => Array.from({ length: 12 }, (_, seat) => ({ rowName, seatNumber: seat + 1, seatType: row < 6 ? 'REGULAR' : row < 10 ? 'PREMIUM' : 'RECLINER' })));
      screens.push({ id: screenId, theatreId, name: index === 0 ? 'Studio 48' : 'Grand Hall 144', capacity: layout.length });
      for (const seat of layout) seats.push({ id: stagingId(`seat:${screenId}:${seat.rowName}:${seat.seatNumber}`), screenId, ...seat });
      for (const day of days) for (const [slot, minutes] of [210,510,810].entries()) {
        // 09:00, 14:00 and 19:00 IST; absolute day selects the movie so reruns never reschedule a slot.
        const ordinal = Math.floor(day.getTime() / 86400000);
        const film = FILMS[(ordinal * 6 + index * 3 + slot) % FILMS.length]!;
        if (film.durationMinutes > 300) throw new Error('Movie duration exceeds the staging slot spacing.');
        const startsAt = new Date(day.getTime() + minutes * 60000), id = stagingId(`show:${screenId}:${startsAt.toISOString()}`);
        shows.push({ id, screenId, movieId: stagingId(`movie:${film.key}`), startsAt, endsAt: new Date(startsAt.getTime() + film.durationMinutes * 60000), status: 'SCHEDULED' });
        for (const price of SEAT_PRICES) showPrices.push({ showId: id, ...price });
      }
    }
  }
  for (const sample of EVENT_SAMPLES) {
    const eventId = stagingId(`event:${sample.key}`), venueId = stagingId(`event-venue:${sample.key}`);
    const city = cities.find(row => row.name === sample.city.name)!;
    events.push({ id: eventId, slug: `staging-${sample.key}`, title: sample.title, description: sample.description, kind: sample.kind, sport: sample.sport,
      durationMinutes: sample.durationMinutes, imageUrl: sample.imageUrl, imageAttribution: sample.imageAttribution, isSample: true, isActive: true });
    for (const person of sample.performers) performers.push({ eventId, ...person });
    for (const team of sample.participants) participants.push({ eventId, ...team });
    venues.push({ id: venueId, cityId: city.id, name: sample.venueName.replace('Sample', 'Showcase'), address: sample.address, kind: sample.venueKind, capacity: sample.capacity });
    for (const section of sample.sections) {
      const sectionId = stagingId(`event-section:${sample.key}:${section.code}`);
      sections.push({ id: sectionId, venueId, code: section.code, name: section.name, position: section.position, sortOrder: section.sortOrder });
      for (const seat of section.seats) eventSeats.push({ id: stagingId(`event-seat:${sectionId}:${seat.rowName}:${seat.seatNumber}`), sectionId, ...seat });
    }
    for (const day of days) {
      const startsAt = new Date(day.getTime() + 450 * 60000), id = stagingId(`event-session:${sample.key}:${startsAt.toISOString()}`);
      sessions.push({ id, eventId, venueId, startsAt, endsAt: new Date(startsAt.getTime() + sample.durationMinutes * 60000), status: 'SCHEDULED' });
      for (const price of sample.prices) eventPrices.push({ sessionId: id, ...price });
    }
  }
  for (const [index, row] of DEMO_LISTINGS.entries()) listings.push({ ...row, id: stagingId(`listing:${row.slug}`), slug: row.slug.replace(/^demo-/, 'staging-'),
    title: row.title.replace(/ — DEMO$/, ''), startsAt: row.kind === 'STREAM' ? null : new Date(days[index % days.length]!.getTime() + 720 * 60000), isActive: true });
  return groups;
}
export function inventoryCounts(groups: CatalogueGroup[]) {
  const labels: Record<CatalogueModel, string> = { city:'cities', movie:'movies', theatre:'theatres', screen:'screens', seat:'seats', show:'shows', showSeatPrice:'showPrices', event:'events',
    eventPerformer:'performers', eventParticipant:'participants', eventVenue:'eventVenues', eventSection:'eventSections', eventSeat:'eventSeats', eventSession:'eventSessions', eventSessionPrice:'eventPrices', demoListing:'listings' };
  return Object.fromEntries(groups.map(group => [labels[group.model], group.rows.length])) as Record<string, number>;
}
