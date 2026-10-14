import { createHash } from 'node:crypto';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { ADDITIONAL_TMDB_MOVIE_IDS } from './dev-movie-expansion-manifest.js';

type TmdbMovie = { id:number; title:string; original_title:string; original_language:string; release_date:string; runtime:number|null;
  overview:string; poster_path:string|null; backdrop_path:string|null; vote_average:number; vote_count:number; genres:{id:number;name:string}[] };
const language:Record<string,string>={hi:'hindi',te:'telugu',ta:'tamil',kn:'kannada',en:'english'};
const safeId=(name:string)=>{const hex=createHash('sha256').update(`cinehook:tmdb-expanded:v1:${name}`).digest('hex').slice(0,32);return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`};
async function movieDetails(id:number,token:string):Promise<TmdbMovie>{
  const response=await fetch(`https://api.themoviedb.org/3/movie/${id}?language=en-US`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!response.ok||Number(response.headers.get('content-length')??0)>1024*1024)throw new Error('Movie metadata provider is unavailable.');
  const raw=await response.text();if(raw.length>1024*1024)throw new Error('Movie metadata provider response is too large.');
  const data=JSON.parse(raw) as TmdbMovie;
  if(data.id!==id||!data.title||!data.original_title||!language[data.original_language]||!/^\d{4}-\d{2}-\d{2}$/.test(data.release_date)
    ||!Number.isInteger(data.runtime)||data.runtime!<30||data.runtime!>240||!data.overview?.trim()||!data.poster_path||!data.backdrop_path
    ||!Number.isFinite(data.vote_average)||data.vote_average<0||data.vote_average>10||!Number.isInteger(data.vote_count)||data.vote_count<1)
    throw new Error('Movie metadata did not pass validation.');
  return data;
}
export async function seedAdditionalMovies(prisma:PrismaClient,token:string,now=new Date()){
  if(!token||!Number.isFinite(now.getTime()))throw new Error('Movie expansion requires provider configuration and a valid clock.');
  const details=await Promise.all(ADDITIONAL_TMDB_MOVIE_IDS.map(id=>movieDetails(id,token)));
  return prisma.$transaction(async tx=>{
    const identity=(await tx.$queryRaw<Array<{database:string;schema:string;port:number}>>`SELECT current_database() AS database,current_schema() AS schema,inet_server_port() AS port`)[0];
    if(identity?.database!=='cinehook_dev'||identity.schema!=='public'||identity.port!==5432)throw new Error('Movie expansion target identity mismatch.');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1667853941,1936024932)`;
    const screens=await tx.screen.findMany({where:{capacity:48},include:{seats:{select:{id:true}},shows:{where:{status:'SCHEDULED',startsAt:{gt:now}},orderBy:{startsAt:'desc'},take:1,include:{prices:true}}},orderBy:[{theatre:{city:{name:'asc'}}},{id:'asc'}]});
    const usable=screens.filter(screen=>screen.seats.length===48&&screen.shows[0]?.prices.length===3);
    if(usable.length<4)throw new Error('Four existing 48-seat screens with complete prices are required; no movie data was added.');
    const latest=await tx.show.aggregate({where:{screenId:{in:usable.map(s=>s.id)},status:'SCHEDULED',startsAt:{gt:now}},_max:{startsAt:true}});
    if(!latest._max.startsAt)throw new Error('Existing future show schedules are required; no movie data was added.');
    const baseDay=Math.floor((latest._max.startsAt.getTime()+330*60000)/86400000);
    const result:{createdMovies:number;createdShows:number;skippedExisting:number;titles:string[]}={createdMovies:0,createdShows:0,skippedExisting:0,titles:[]};
    for(const [index,data] of details.entries()){
      const source=`https://www.themoviedb.org/movie/${data.id}`;
      const existing=await tx.movie.findFirst({where:{OR:[{metadataSourceUrl:source},{title:data.title,language:language[data.original_language],releaseDate:new Date(`${data.release_date}T00:00:00Z`)}]}});
      if(existing){result.skippedExisting++;continue;}
      const id=safeId(String(data.id));
      const collections=['recommended',...(data.original_language==='hi'?['bollywood']:['te','ta','kn'].includes(data.original_language)?['south']:[]),...(index%2===0?['popular']:['picks'])];
      const movie=await tx.movie.create({data:{id,title:data.title,description:data.overview.trim(),durationMinutes:data.runtime!,releaseDate:new Date(`${data.release_date}T00:00:00Z`),language:language[data.original_language]!,genres:data.genres.map(g=>g.name.toLowerCase()),
        posterUrl:`https://image.tmdb.org/t/p/w500${data.poster_path}`,backdropUrl:`https://image.tmdb.org/t/p/w1280${data.backdrop_path}`,collections,metadataSourceUrl:source,
        artworkKind:'TMDB',artworkSourceUrl:source,artworkAttribution:'This product uses the TMDB API but is not endorsed or certified by TMDB.',ratingValue:data.vote_average,ratingVoteCount:data.vote_count,ratingSource:'TMDB',ratingSourceUrl:source,ratingFetchedAt:now,isActive:true}});
      result.createdMovies++;result.titles.push(movie.title);
      const screen=usable[index%usable.length]!;
      const day=baseDay+1+Math.floor(index/usable.length);
      const startsAt=new Date(day*86400000+14*3600000-330*60000),endsAt=new Date(startsAt.getTime()+movie.durationMinutes*60000);
      const conflicts=await tx.show.count({where:{screenId:screen.id,status:'SCHEDULED',startsAt:{lt:endsAt},endsAt:{gt:startsAt}}});
      if(conflicts)throw new Error('A scheduled movie slot conflicts with existing inventory; transaction rolled back.');
      const template=screen.shows[0]!;
      const show=await tx.show.create({data:{id:safeId(`show:${data.id}:${screen.id}:${startsAt.toISOString()}`),movieId:movie.id,screenId:screen.id,startsAt,endsAt,status:'SCHEDULED'}});
      await tx.showSeatPrice.createMany({data:template.prices.map(price=>({showId:show.id,seatType:price.seatType,pricePaise:price.pricePaise}))});
      result.createdShows++;
    }
    return result;
  },{isolationLevel:'ReadCommitted',maxWait:60000,timeout:120000});
}
