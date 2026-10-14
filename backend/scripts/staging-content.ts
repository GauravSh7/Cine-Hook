import {z} from 'zod';
import type {ParitySnapshot} from './staging-parity.js';
import type {ImportRow} from './staging-manifest.js';

const image=z.string().regex(/^\/[A-Za-z0-9]+\.jpg$/).nullable();
const provider=z.object({id:z.number().int().positive(),title:z.string(),original_title:z.string(),original_language:z.string(),release_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),vote_average:z.number().finite().min(0).max(10),vote_count:z.number().int().nonnegative(),poster_path:image,backdrop_path:image});
const video=z.object({key:z.string().regex(/^[A-Za-z0-9_-]{11}$/),official:z.literal(true),site:z.literal('YouTube'),type:z.literal('Trailer'),available:z.literal(true)});
const languages:Record<string,string>={en:'english',hi:'hindi',ta:'tamil',te:'telugu',kn:'kannada',ml:'malayalam',bn:'bengali'};
const norm=(s:unknown)=>String(s??'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases:Record<string,string[]>={salaarpart1ceasefire:['salaarparticeasefire'],stree2:['stree2sarkatekaatank'],baahubali2theconclusion:['bahubali2theconclusion'],lagaan:['lagaanonceuponatimeinindia']};
export function exactTmdbId(movie:ImportRow):number|null{
  const values=[movie.ratingSourceUrl,movie.metadataSourceUrl,movie.artworkSourceUrl].filter(x=>typeof x==='string').map(x=>(x as string).match(/^https:\/\/www\.themoviedb\.org\/movie\/([1-9]\d*)$/)?.[1]).filter((x):x is string=>!!x);
  return values.length&&new Set(values).size===1?Number(values[0]):null;
}
export type ContentReview={version:number;checkedAt:string;results:Array<{movieId:string;status:number|string;provider?:unknown;videos?:unknown[]}>;wikiRecords:unknown[]};
export function applyContentReview(input:ParitySnapshot,review:ContentReview){
  if(review.version!==1||!Number.isFinite(Date.parse(review.checkedAt))||!Array.isArray(review.results))throw new Error('Invalid content review.');
  const snapshot=structuredClone(input),audit:Array<{movieId:string;title:string;matched:boolean;artworkReplaced:boolean;ratingAction:string;trailerAdded:boolean}>=[];
  for(const movie of snapshot.groups.find(g=>g.model==='movie')!.rows){
    const evidence=review.results.filter(r=>r.movieId===movie.id),d=provider.safeParse(evidence[0]?.provider);
    const titles=[norm(movie.title),...(aliases[norm(movie.title)]??[])];
    const matched=evidence.length===1&&evidence[0]!.status===200&&d.success&&d.data.id===exactTmdbId(movie)
      &&languages[d.data.original_language]===movie.language&&d.data.release_date.slice(0,4)===(movie.releaseDate as Date).toISOString().slice(0,4)
      &&[norm(d.data.title),norm(d.data.original_title)].some(t=>t.length>0&&titles.includes(t));
    const entry={movieId:String(movie.id),title:String(movie.title),matched:!!matched,artworkReplaced:false,ratingAction:movie.ratingValue!=null?'PRESERVED':'UNVERIFIED',trailerAdded:false};audit.push(entry);
    if(!matched||!d.success)continue;
    const source=`https://www.themoviedb.org/movie/${d.data.id}`;
    const wiki=[movie.posterUrl,movie.backdropUrl].some(v=>typeof v==='string'&&v.startsWith('https://upload.wikimedia.org/'));
    if(wiki&&d.data.poster_path&&d.data.backdrop_path){
      Object.assign(movie,{posterUrl:`https://image.tmdb.org/t/p/w500${d.data.poster_path}`,backdropUrl:`https://image.tmdb.org/t/p/w1280${d.data.backdrop_path}`,artworkKind:'TMDB',artworkSourceUrl:source,artworkAttribution:'This product uses the TMDB API but is not endorsed or certified by TMDB.'});entry.artworkReplaced=true;
    }
    if(movie.ratingValue==null){
      if(d.data.vote_count===0)entry.ratingAction='NO_PROVIDER_VOTES';
      else if(d.data.release_date>review.checkedAt.slice(0,10))entry.ratingAction='HELD_UNRELEASED';
      else {Object.assign(movie,{ratingValue:d.data.vote_average,ratingVoteCount:d.data.vote_count,ratingSource:'TMDB',ratingSourceUrl:source,ratingFetchedAt:new Date(review.checkedAt)});entry.ratingAction='ADDED';}
    }
    if(!movie.trailerVideoId){
      const trailer=(evidence[0]!.videos??[]).map(v=>video.safeParse(v)).find(v=>v.success);
      if(trailer?.success){Object.assign(movie,{trailerVideoId:trailer.data.key,trailerSourceUrl:source,trailerVerifiedAt:new Date(review.checkedAt)});entry.trailerAdded=true;}
    }
  }
  return {snapshot,audit};
}
