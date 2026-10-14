import type { CatalogueGroup, CatalogueModel, ImportRow } from './staging-manifest.js';
import { assertCatalogueGroups, catalogueGroup, catalogueModels, CATALOGUE_SPECS, digest, encoded, rowKey } from './staging-shape.js';

type Exclusion={expired:number;cancelled:number;prices:number};
export type ParitySnapshot={version:1;capturedAt:Date;sourceCounts:Record<string,number>;exclusions:Record<'show'|'eventSession',Exclusion>;groups:CatalogueGroup[]};
const fail=():never=>{throw new Error('Invalid catalogue-only snapshot or inventory graph.');};
const rows=(groups:CatalogueGroup[],model:CatalogueModel)=>groups.find(g=>g.model===model)!.rows;
const byId=(values:ImportRow[])=>new Map(values.map(r=>[r.id,r]));
const time=(v:unknown)=>v instanceof Date&&Number.isFinite(v.getTime())?v.getTime():fail();

export function buildParitySnapshot(input:CatalogueGroup[],asOf:Date):ParitySnapshot {
  assertCatalogueGroups(input,true);time(asOf);
  const groups=structuredClone(input), sourceCounts=Object.fromEntries(input.map(g=>[g.model,g.rows.length]));
  const exclusions={} as ParitySnapshot['exclusions'];
  for(const [model,priceModel,parentKey]of [['show','showSeatPrice','showId'],['eventSession','eventSessionPrice','sessionId']] as const){
    const all=rows(groups,model), kept=all.filter(r=>r.status==='SCHEDULED'&&time(r.startsAt)>asOf.getTime());
    const ids=new Set(kept.map(r=>r.id)),oldPrices=rows(groups,priceModel),keptPrices=oldPrices.filter(r=>ids.has(r[parentKey]));
    exclusions[model]={expired:all.filter(r=>time(r.startsAt)<=asOf.getTime()).length,cancelled:all.filter(r=>r.status!=='SCHEDULED'&&time(r.startsAt)>asOf.getTime()).length,prices:oldPrices.length-keptPrices.length};
    groups.find(g=>g.model===model)!.rows=kept;groups.find(g=>g.model===priceModel)!.rows=keptPrices;
  }
  const snapshot:ParitySnapshot={version:1,capturedAt:new Date(asOf),sourceCounts,exclusions,groups};
  validateParitySnapshot(snapshot);return snapshot;
}

export function validateParitySnapshot(s:ParitySnapshot,now?:Date):void {
  if(s.version!==1)fail();time(s.capturedAt);assertCatalogueGroups(s.groups,true);
  const get=(model:CatalogueModel)=>rows(s.groups,model),map=(model:CatalogueModel)=>byId(get(model));
  for(const g of s.groups){
    if(new Set(g.rows.map(r=>rowKey(r,g.keys))).size!==g.rows.length||new Set(g.rows.map(r=>rowKey(r,g.identity).toLowerCase())).size!==g.rows.length)fail();
    for(const r of g.rows)for(const field of CATALOGUE_SPECS[g.model].dates)if(r[field]!=null)time(r[field]);
  }
  for(const [child,key,parent]of [['theatre','cityId','city'],['screen','theatreId','theatre'],['seat','screenId','screen'],['show','movieId','movie'],['show','screenId','screen'],['showSeatPrice','showId','show'],['eventPerformer','eventId','event'],['eventParticipant','eventId','event'],['eventVenue','cityId','city'],['eventSection','venueId','eventVenue'],['eventSeat','sectionId','eventSection'],['eventSession','eventId','event'],['eventSession','venueId','eventVenue'],['eventSessionPrice','sessionId','eventSession']] as const){
    const parents=map(parent);if(get(child).some(r=>!parents.has(r[key])))fail();
  }
  for(const screen of get('screen'))if(get('seat').filter(r=>r.screenId===screen.id).length!==screen.capacity)fail();
  const sections=map('eventSection');
  for(const venue of get('eventVenue'))if(get('eventSeat').filter(r=>sections.get(r.sectionId)?.venueId===venue.id).length!==venue.capacity)fail();
  for(const price of [...get('showSeatPrice'),...get('eventSessionPrice')])if(!Number.isSafeInteger(price.pricePaise)||Number(price.pricePaise)<=0)fail();
  for(const [model,parentKey,priceModel,priceKey,tierField]of [['show','screenId','showSeatPrice','showId','seatType'],['eventSession','venueId','eventSessionPrice','sessionId','ticketTier']] as const){
    const grouped=new Map<unknown,ImportRow[]>();
    for(const r of get(model)){
      if(r.status!=='SCHEDULED'||time(r.endsAt)<=time(r.startsAt))fail();
      if(time(r.startsAt)<=(now??s.capturedAt).getTime())throw new Error('Frozen catalogue contains expired sessions; generate a new preview.');
      const tiers=new Set((model==='show'?get('seat').filter(x=>x.screenId===r.screenId):get('eventSeat').filter(x=>sections.get(x.sectionId)?.venueId===r.venueId)).map(x=>x[tierField]));
      const prices=get(priceModel).filter(x=>x[priceKey]===r.id);
      if(prices.length!==tiers.size||prices.some(x=>!tiers.has(x[tierField])))fail();
      const list=grouped.get(r[parentKey])??[];list.push(r);grouped.set(r[parentKey],list);
    }
    for(const list of grouped.values()){
      list.sort((a,b)=>time(a.startsAt)-time(b.startsAt));
      for(let i=1;i<list.length;i++)if(time(list[i]!.startsAt)<time(list[i-1]!.endsAt))fail();
    }
  }
}

export function decodeParitySnapshot(json:string):ParitySnapshot {
  const parsed=JSON.parse(json) as ParitySnapshot;
  assertCatalogueGroups(parsed.groups,true);parsed.capturedAt=new Date(parsed.capturedAt);
  for(const group of parsed.groups)for(const row of group.rows)for(const field of CATALOGUE_SPECS[group.model].dates)if(row[field]!=null)row[field]=new Date(String(row[field]));
  validateParitySnapshot(parsed);return parsed;
}

export function compareCatalogue(snapshot:ParitySnapshot,target:CatalogueGroup[]){
  const models={} as Record<CatalogueModel,{source:number;target:number;missing:number;different:number;extra:number;sourceHash:string;targetHash:string;fieldDifferences:Record<string,number>}>;
  for(const g of snapshot.groups){
    const actual=target.find(x=>x.model===g.model)?.rows??[],index=new Map(actual.map(r=>[rowKey(r,g.keys),r])),sourceKeys=new Set(g.rows.map(r=>rowKey(r,g.keys)));
    let missing=0,different=0;const fieldDifferences:Record<string,number>={};
    for(const row of g.rows){const found=index.get(rowKey(row,g.keys));if(!found){missing++;continue;}
      const changed=Object.keys(row).filter(k=>encoded(row[k])!==encoded(found[k]));if(changed.length)different++;
      for(const key of changed)fieldDifferences[key]=(fieldDifferences[key]??0)+1;
    }
    const projected=actual.map(r=>Object.fromEntries(CATALOGUE_SPECS[g.model].fields.filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]])));
    const ordered=(list:ImportRow[])=>[...list].sort((a,b)=>rowKey(a,g.keys).localeCompare(rowKey(b,g.keys)));
    models[g.model]={source:g.rows.length,target:actual.length,missing,different,extra:actual.filter(r=>!sourceKeys.has(rowKey(r,g.keys))).length,
      sourceHash:digest(ordered(g.rows)),targetHash:digest(ordered(projected)),fieldDifferences};
  }
  const sourceSeats=rows(snapshot.groups,'seat'),actualSeats=target.find(g=>g.model==='seat')?.rows??[];
  const layout=(list:ImportRow[])=>list.map(r=>({id:r.id,row:r.rowName,number:r.seatNumber,tier:r.seatType??r.ticketTier,sectionId:r.sectionId})).sort((a,b)=>encoded(a).localeCompare(encoded(b)));
  const screens=rows(snapshot.groups,'screen').map(screen=>{
    const seats=sourceSeats.filter(r=>r.screenId===screen.id),actual=actualSeats.filter(r=>r.screenId===screen.id);
    const tiers=Object.fromEntries([...new Set(seats.map(r=>String(r.seatType)))].map(t=>[t,seats.filter(r=>r.seatType===t).length]));
    return {id:screen.id,name:screen.name,capacity:screen.capacity,seats:seats.length,tiers,rows:[...new Set(seats.map(r=>r.rowName))],layoutHash:digest(layout(seats)),targetLayoutHash:digest(layout(actual)),layoutMatches:encoded(layout(seats))===encoded(layout(actual))};
  });
  const sections=byId(rows(snapshot.groups,'eventSection')),actualSections=byId(target.find(g=>g.model==='eventSection')?.rows??[]);
  const venues=rows(snapshot.groups,'eventVenue').map(venue=>{
    const seats=rows(snapshot.groups,'eventSeat').filter(r=>sections.get(r.sectionId)?.venueId===venue.id),actual=(target.find(g=>g.model==='eventSeat')?.rows??[]).filter(r=>actualSections.get(r.sectionId)?.venueId===venue.id);
    return {id:venue.id,name:venue.name,capacity:venue.capacity,seats:seats.length,sections:rows(snapshot.groups,'eventSection').filter(r=>r.venueId===venue.id),layoutHash:digest(layout(seats)),targetLayoutHash:digest(layout(actual)),layoutMatches:encoded(layout(seats))===encoded(layout(actual))};
  });
  const movies=rows(snapshot.groups,'movie');
  return {models,layouts:{screens,venues},metadata:{movies:movies.length,hindi:movies.filter(r=>r.descriptionHindi).length,english:movies.filter(r=>r.description).length,
    tmdbRatings:movies.filter(r=>r.ratingSource==='TMDB'&&r.ratingValue!=null).length,trailers:movies.filter(r=>r.trailerVideoId).length,posters:movies.filter(r=>r.posterUrl).length,backdrops:movies.filter(r=>r.backdropUrl).length,
    collections:Object.fromEntries([...new Set(movies.flatMap(r=>(r.collections as string[])??[]))].sort().map(k=>[k,movies.filter(r=>((r.collections as string[])??[]).includes(k)).length]))},sourceCounts:snapshot.sourceCounts,exclusions:snapshot.exclusions};
}

export async function readCatalogue(tx:unknown):Promise<CatalogueGroup[]> {
  const groups:CatalogueGroup[]=[];
  for(const model of catalogueModels){
    const store=(tx as Record<string,{findMany:(args:unknown)=>Promise<ImportRow[]>}>)[model]!;
    groups.push(catalogueGroup(model,await store.findMany({select:Object.fromEntries(CATALOGUE_SPECS[model].fields.map(f=>[f,true])),orderBy:CATALOGUE_SPECS[model].keys.map(k=>({[k]:'asc'}))})));
  }
  return groups;
}
