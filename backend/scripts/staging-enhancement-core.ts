import {assertCatalogueGroups,CATALOGUE_SPECS,digest,rowKey} from './staging-shape.js';
import {buildParitySnapshot} from './staging-parity.js';
import type {CatalogueGroup} from './staging-manifest.js';

export function enhancementArguments(args:string[]){
  if(args.length===0||args.length===1&&args[0]==='--dry-run')return {apply:false,approvedHash:null};
  if(args.length===3&&args[0]==='--apply'&&args[1]==='--approved-hash'&&/^[a-f0-9]{64}$/.test(args[2]!))return {apply:true,approvedHash:args[2]!};
  throw new Error('Enhancement arguments rejected.');
}
export function decodeEnhancementGroups(input:unknown):CatalogueGroup[]{
  const groups=input as CatalogueGroup[];assertCatalogueGroups(groups,true);
  for(const group of groups)for(const row of group.rows)for(const field of CATALOGUE_SPECS[group.model].dates)if(row[field]!=null)row[field]=new Date(String(row[field]));
  return groups;
}
export function validateEnhancement(baseline:CatalogueGroup[],patch:CatalogueGroup[],current:CatalogueGroup[],now:Date){
  for(const groups of [baseline,patch,current])assertCatalogueGroups(groups,true);
  if(patch.some(g=>!['movie','show','showSeatPrice'].includes(g.model)&&g.rows.length))throw new Error('Enhancement scope rejected.');
  const movies=patch.find(g=>g.model==='movie')!.rows,shows=patch.find(g=>g.model==='show')!.rows;
  if(movies.length<10||movies.length>15||shows.length!==movies.length)throw new Error('Enhancement scope rejected.');
  if(shows.some(s=>!(s.startsAt instanceof Date)||s.startsAt<=now))throw new Error('Enhancement shows expired.');
  if(movies.some(m=>!(m.releaseDate instanceof Date)||m.releaseDate>now||!m.description||!m.descriptionHindi||!m.trailerVideoId||!m.posterUrl||!m.backdropUrl||m.artworkKind!=='TMDB'||m.ratingSource!=='TMDB'))throw new Error('Enhancement metadata rejected.');
  for(const group of current){
    const addition=patch.find(g=>g.model===group.model)!,base=baseline.find(g=>g.model===group.model)!;
    const expected=new Map(addition.rows.map(r=>[rowKey(r,group.keys),r]));
    const retained=group.rows.filter(row=>{const added=expected.get(rowKey(row,group.keys));if(!added)return true;if(digest(row)!==digest(added))throw new Error('Enhancement existing row differs.');return false;});
    if(digest({...group,rows:retained})!==digest(base))throw new Error('Enhancement baseline drift.');
  }
  const combined=baseline.map(g=>({...g,rows:[...g.rows,...patch.find(p=>p.model===g.model)!.rows]}));
  buildParitySnapshot(combined,now);
  for(const show of shows){
    const movie=movies.find(m=>m.id===show.movieId);if(!movie||(show.endsAt as Date).getTime()-(show.startsAt as Date).getTime()!==Number(movie.durationMinutes)*60000)throw new Error('Enhancement duration differs.');
    const proposed=patch.find(g=>g.model==='showSeatPrice')!.rows.filter(p=>p.showId===show.id);
    const templates=baseline.find(g=>g.model==='show')!.rows.filter(s=>s.screenId===show.screenId);
    const signature=(prices:typeof proposed)=>digest(prices.map(p=>({seatType:p.seatType,pricePaise:p.pricePaise})).sort((a,b)=>String(a.seatType).localeCompare(String(b.seatType))));
    if(!templates.some(s=>signature(baseline.find(g=>g.model==='showSeatPrice')!.rows.filter(p=>p.showId===s.id))===signature(proposed)))throw new Error('Enhancement prices differ from existing screen.');
  }
}
