import { createHash } from 'node:crypto';
import type { CatalogueGroup, CatalogueModel, ImportRow } from './staging-manifest.js';

// Explicit scalar projection: no relations, users, audit actors or financial records.
const spec = (fields:string, identity:string, immutable=identity, keys='id', dates='') => ({
  fields:fields.split(' '),identity:identity.split(' '),immutable:immutable.split(' '),keys:keys.split(' '),dates:dates?dates.split(' '):[],
});
export const CATALOGUE_SPECS:Record<CatalogueModel,ReturnType<typeof spec>> = {
  city:spec('id name state countryCode','countryCode state name'),
  movie:spec('id title description descriptionHindi trailerVideoId trailerSourceUrl trailerVerifiedAt durationMinutes releaseDate language genres posterUrl backdropUrl collections metadataSourceUrl artworkKind artworkAttribution artworkSourceUrl ratingValue ratingVoteCount ratingSource ratingSourceUrl ratingFetchedAt isActive','title language releaseDate',undefined,'id','releaseDate trailerVerifiedAt ratingFetchedAt'),
  theatre:spec('id name address cityId','cityId name'),
  screen:spec('id name capacity theatreId','theatreId name','theatreId name capacity'),
  seat:spec('id screenId rowName seatNumber seatType','screenId rowName seatNumber','screenId rowName seatNumber seatType'),
  show:spec('id movieId screenId startsAt endsAt status','screenId startsAt','movieId screenId startsAt','id','startsAt endsAt'),
  showSeatPrice:spec('showId seatType pricePaise','showId seatType',undefined,'showId seatType'),
  event:spec('id slug title description kind sport durationMinutes imageUrl imageAttribution isSample isActive','slug','slug kind sport'),
  eventPerformer:spec('eventId name biography','eventId name',undefined,'eventId name'),
  eventParticipant:spec('eventId name','eventId name',undefined,'eventId name'),
  eventVenue:spec('id cityId name address kind capacity','cityId name','cityId name kind capacity'),
  eventSection:spec('id venueId code name position sortOrder','venueId code','venueId code position sortOrder'),
  eventSeat:spec('id sectionId rowName seatNumber ticketTier','sectionId rowName seatNumber','sectionId rowName seatNumber ticketTier'),
  eventSession:spec('id eventId venueId startsAt endsAt status','venueId startsAt','eventId venueId startsAt','id','startsAt endsAt'),
  eventSessionPrice:spec('sessionId ticketTier pricePaise','sessionId ticketTier',undefined,'sessionId ticketTier'),
  demoListing:spec('id slug kind title description category cityName venueName startsAt durationMinutes imageUrl imageAttribution isActive','slug','slug kind','id','startsAt'),
};
export const catalogueModels=Object.keys(CATALOGUE_SPECS) as CatalogueModel[];
export function catalogueGroup(model:CatalogueModel,rows:ImportRow[]=[]):CatalogueGroup {
  const s=CATALOGUE_SPECS[model];return {model,keys:[...s.keys],identity:[...s.identity],immutable:[...s.immutable],rows};
}
export function assertCatalogueGroups(groups:CatalogueGroup[], complete=false) {
  if(!Array.isArray(groups)||complete&&groups.length!==catalogueModels.length)throw new Error('Invalid catalogue-only snapshot.');
  const seen=new Set<string>();
  for(const g of groups){
    if(!g||!Object.hasOwn(CATALOGUE_SPECS,g.model)||seen.has(g.model))throw new Error('Invalid catalogue-only snapshot.');
    seen.add(g.model);const s=CATALOGUE_SPECS[g.model];
    if(!Array.isArray(g.rows)||(['keys','identity','immutable'] as const).some(k=>JSON.stringify(g[k])!==JSON.stringify(s[k])))throw new Error('Invalid catalogue-only snapshot.');
    for(const row of g.rows)if(!row||Object.keys(row).some(k=>!s.fields.includes(k))||g.keys.some(k=>row[k]==null))throw new Error('Invalid catalogue-only snapshot.');
  }
}
function canonical(v:unknown):unknown {
  if(v instanceof Date)return v.toISOString();
  if(Array.isArray(v))return v.map(canonical);
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)]));
  return v;
}
export const encoded=(v:unknown)=>JSON.stringify(canonical(v));
export const digest=(v:unknown)=>createHash('sha256').update(encoded(v)).digest('hex');
export const rowKey=(row:ImportRow,keys:string[])=>encoded(keys.map(k=>row[k]));
