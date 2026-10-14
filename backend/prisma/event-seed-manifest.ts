import { createHash } from 'node:crypto';
import { EVENT_MEDIA, stockPhoto } from './catalogue-media.js';
import type { EventKind, EventTicketTier, EventVenueKind } from '../src/generated/prisma/client.js';

export type SampleSection = { code: string; name: string; position: string; sortOrder: number;
  seats: Array<{ rowName: string; seatNumber: number; ticketTier: EventTicketTier }> };
export type EventSample = { key: string; city: { name: string; state: string; countryCode: string };
  slug: string; title: string; description: string; kind: EventKind; sport: string | null; durationMinutes: number;
  imageUrl: string; imageAttribution: string; performers: Array<{ name: string; biography: string }>; participants: Array<{ name: string }>;
  venueName: string; venueKind: EventVenueKind; address: string; capacity: number; sections: SampleSection[];
  prices: Array<{ ticketTier: EventTicketTier; pricePaise: number }> };

/** Original sample namespace, independent of movie/cinema IDs. No provider/network side effects. */
export function eventSeedId(key: string): string {
  const hex = createHash('sha256').update(`cinehook:fictional-event-development:v1:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const cities = [
  { key: 'delhi', name: 'New Delhi', state: 'Delhi', countryCode: 'IN', performer: 'Kavya Paperkite', sport: 'cricket', teams: ['Paperkite XI', 'Copper Comets XI'] },
  { key: 'mumbai', name: 'Mumbai', state: 'Maharashtra', countryCode: 'IN', performer: 'Rohan Lantern', sport: 'football', teams: ['Lantern Rovers', 'Harbour Mosaic FC'] },
  { key: 'bengaluru', name: 'Bengaluru', state: 'Karnataka', countryCode: 'IN', performer: 'Meera Cloudstep', sport: 'basketball', teams: ['Cloudstep Hoops', 'Indigo Orbit'] },
] as const;
const sections = (sports: boolean, workshop: boolean): SampleSection[] => {
  const slots: Array<[string, string, EventTicketTier]> = sports
    ? [['NORTH', 'North stand', 'STANDARD'], ['SOUTH', 'South stand', 'STANDARD'], ['EAST', 'East stand', 'PREMIUM'], ['WEST', 'West stand', 'VIP']]
    : [['FRONT', 'Front rows', 'VIP'], ['MIDDLE', 'Middle rows', 'PREMIUM'], ['REAR', 'Rear rows', 'STANDARD']];
  return slots.map(([code, name, ticketTier], sortOrder) => ({ code, name, position: code === 'MIDDLE' ? 'REAR' : code, sortOrder,
    seats: ['A', 'B'].flatMap(rowName => Array.from({ length: workshop ? 6 : 12 }, (_, index) => ({ rowName, seatNumber: index + 1, ticketTier }))) }));
};
export const EVENT_SAMPLES: EventSample[] = cities.flatMap(city => (['comedy', 'sport', 'workshop'] as const).map(category => {
  const key = `${city.key}-${category}`, sports = category === 'sport', workshop = category === 'workshop';
  return { key, city: { name: city.name, state: city.state, countryCode: city.countryCode }, slug: `sample-${key}`,
    title: sports ? `${city.teams[0]} vs ${city.teams[1]}` : workshop ? `Paper & Light: ${city.name} seated workshop` : `${city.performer}: Small Everyday Wonders`,
    description: sports ? `Fictional ${city.sport} match between two invented teams. Reserved numbered seats around the playing area. Development sample; no real match, club, venue or schedule is represented.`
      : workshop ? 'A fictional seated paper-craft workshop with individual numbered places and a front demonstration area. Development sample; no real class or venue is represented.'
        : 'An original fictional comedy evening about everyday surprises, with a front stage and individually numbered seats. Development sample; no real performer, show or venue is represented.',
    kind: sports ? 'SPORTS' : workshop ? 'ACTIVITIES' : 'EVENTS', sport: sports ? city.sport : null,
    durationMinutes: sports ? city.sport === 'cricket' ? 180 : 120 : workshop ? 90 : 75,
    imageUrl: stockPhoto(EVENT_MEDIA[key]!),
    imageAttribution: 'Contextual stock photograph from Unsplash, Unsplash license. Not official event promotional media.',
    performers: category === 'comedy' ? [{ name: city.performer, biography: 'Original invented comedy performer for this development sample. No real person or appearance is represented.' }] : [],
    participants: sports ? city.teams.map(name => ({ name })) : [],
    venueName: `CineHook Sample ${city.name} ${sports ? city.sport === 'basketball' ? 'Court Arena' : 'Field Stadium' : workshop ? 'Craft Hall' : 'Comedy Hall'}`,
    venueKind: sports ? city.sport === 'basketball' ? 'ARENA' : 'STADIUM' : 'AUDITORIUM',
    address: `Fictional development venue in ${city.name}; not a real street address or operating venue.`,
    capacity: sports ? 96 : workshop ? 36 : 72, sections: sections(sports, workshop),
    prices: [{ ticketTier: 'STANDARD', pricePaise: sports ? 30000 : workshop ? 25000 : 40000 },
      { ticketTier: 'PREMIUM', pricePaise: sports ? 50000 : workshop ? 40000 : 65000 }, { ticketTier: 'VIP', pricePaise: sports ? 80000 : workshop ? 60000 : 95000 }],
  };
}));

/** Seven next IST calendar days at the persisted v1 sample hour, 13:00 IST (07:30 UTC). */
export function eventStarts(now: Date): Date[] {
  if (!Number.isFinite(now.getTime())) throw new Error('A valid event seed clock is required.');
  const ist = new Date(now.getTime() + 330 * 60000);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return Array.from({ length: 7 }, (_, i) => new Date(day + (i + 1) * 86400000 + (7 * 60 + 30) * 60000));
}

/** Preserve the original v1 ID token (date at 13:00 UTC), independent of operational start time.
 * The first personal-DB seed persisted 13:00 IST under these IDs; IDs must not reschedule history.
 */
export function eventSessionSeedId(key: string, startsAt: Date): string {
  if (!Number.isFinite(startsAt.getTime())) throw new Error('A valid event session clock is required.');
  const ist = new Date(startsAt.getTime() + 330 * 60000);
  const anchor = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 13));
  return eventSeedId(`session:${key}:${anchor.toISOString()}`);
}
