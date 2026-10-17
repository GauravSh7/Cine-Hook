// Read-only preparation only: this entry point intentionally has no apply mode.
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import dotenv from 'dotenv';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../src/generated/prisma/client.js';
import {resolveStagingTarget,verifyStagingIdentity,verifyStagingBackend} from './staging-target.js';
import {readCatalogue} from './staging-parity.js';
import {catalogueModels,catalogueGroup,digest} from './staging-shape.js';
import {stagingId,type ImportRow} from './staging-manifest.js';
import {inspectCatalogue} from './staging-catalogue-core.js';
import {dependencyErrorDetails} from '../src/lib/dependency-diagnostics.js';

const directory=new URL('../.staging-parity/enhancement-v1/',import.meta.url);
const language:Record<string,string>={en:'english',hi:'hindi',ta:'tamil',te:'telugu',kn:'kannada',ml:'malayalam'};
let phase='configuration';
async function main(){
  if(process.argv.length>2)throw new Error('Preview accepts no arguments and never writes database data.');
  const settings=dotenv.parse(await readFile(new URL('../.env.staging',import.meta.url)));
  const local=dotenv.parse(await readFile(new URL('../.env',import.meta.url)));
  const token=local.TMDB_READ_ACCESS_TOKEN;if(!token)throw new Error('TMDB configuration unavailable.');
  const target=resolveStagingTarget(settings);phase='hosted-target-verification';await verifyStagingBackend(target);phase='database-baseline';
  const db=new PrismaClient({adapter:new PrismaPg({connectionString:target.url,max:1,connectionTimeoutMillis:45000,options:'-c default_transaction_read_only=on -c timezone=UTC -c statement_timeout=30000'})});
  try{
    const baseline=await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      phase='database-identity';const [identity]=await tx.$queryRaw<Array<{database:string;role:string;schema:string;port:number}>>`SELECT current_database() AS database,current_user AS role,current_schema() AS schema,inet_server_port() AS port`;
      verifyStagingIdentity(target,identity);phase='catalogue-read';return readCatalogue(tx);
    },{isolationLevel:'RepeatableRead',maxWait:45000,timeout:180000});
    phase='provider-metadata';const capturedAt=new Date(),get=(model:string)=>baseline.find(g=>g.model===model)!.rows;
    const current=get('movie'),existingSources=new Set(current.map(m=>m.metadataSourceUrl));
    const api=async(path:string)=>{const r=await fetch(`https://api.themoviedb.org/3/${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw new Error('TMDB request unavailable.');return r.json() as Promise<any>;};
    let cached:{movies:ImportRow[];evidence:unknown[]}|null=null;
    try{const prior=JSON.parse(await readFile(new URL('preview.json',directory),'utf8'));const groups=JSON.parse(await readFile(new URL('patch.json',directory),'utf8'));const media=JSON.parse(await readFile(new URL('provider-evidence.json',directory),'utf8'));if(capturedAt.getTime()-Date.parse(prior.capturedAt)<3600000&&prior.patchHash===digest(groups)){cached={movies:groups.find((g:any)=>g.model==='movie').rows,evidence:media};for(const m of cached.movies)for(const key of ['releaseDate','ratingFetchedAt','trailerVerifiedAt'])m[key]=new Date(String(m[key]));}}catch{/* No reusable provider evidence; fetch fresh. */}
    const pages=cached?[]:await Promise.all(Array.from({length:10},(_,i)=>api(`movie/top_rated?language=en-US&page=${i+1}`)));
    const candidates=pages.flatMap(p=>p.results);
    const movies:ImportRow[]=cached?.movies??[],evidence:unknown[]=cached?.evidence??[];
    async function consider(candidate:any){
      if(movies.length>=12)return;
      const source=`https://www.themoviedb.org/movie/${candidate.id}`;
      if(existingSources.has(source))return;
      const [en,hi]=await Promise.all([api(`movie/${candidate.id}?language=en-US&append_to_response=videos`),api(`movie/${candidate.id}?language=hi-IN`)]);
      if(en.id!==candidate.id||hi.id!==candidate.id||!en.title||!language[en.original_language]||!en.overview||!hi.overview||!/[\u0900-\u097f]/.test(hi.overview)||!/^\/[A-Za-z0-9]+\.jpg$/.test(en.poster_path??'')||!/^\/[A-Za-z0-9]+\.jpg$/.test(en.backdrop_path??'')||!Number.isInteger(en.runtime)||en.runtime<30||en.runtime>240||!Number.isInteger(en.vote_count)||en.vote_count<1||!Number.isFinite(en.vote_average)||en.vote_average<0||en.vote_average>10||!/^\d{4}-\d{2}-\d{2}$/.test(en.release_date)||en.release_date>capturedAt.toISOString().slice(0,10))return;
      const trailer=en.videos.results.find((v:any)=>v.site==='YouTube'&&v.type==='Trailer'&&v.official===true&&/^[\w-]{11}$/.test(v.key));
      if(!trailer)return;
      const posterUrl=`https://image.tmdb.org/t/p/w500${en.poster_path}`,backdropUrl=`https://image.tmdb.org/t/p/w1280${en.backdrop_path}`;
      const checks=await Promise.all([posterUrl,backdropUrl,`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${trailer.key}`)}&format=json`].map(async url=>{try{return (await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'})).ok}catch{return false}}));
      if(checks.some(ok=>!ok)||movies.length>=12)return;
      movies.push({id:stagingId(`enhancement-v1:tmdb:${en.id}`),title:en.title,description:en.overview,descriptionHindi:hi.overview,durationMinutes:en.runtime,releaseDate:new Date(`${en.release_date}T00:00:00Z`),language:language[en.original_language],genres:en.genres.map((g:any)=>g.name.toLowerCase()),collections:['recommended','popular',...(en.original_language==='hi'?['bollywood']:[])],posterUrl,backdropUrl,metadataSourceUrl:source,artworkKind:'TMDB',artworkSourceUrl:source,artworkAttribution:'This product uses the TMDB API but is not endorsed or certified by TMDB.',ratingValue:en.vote_average,ratingVoteCount:en.vote_count,ratingSource:'TMDB',ratingSourceUrl:source,ratingFetchedAt:capturedAt,trailerVideoId:trailer.key,trailerSourceUrl:source,trailerVerifiedAt:capturedAt,isActive:true});
      evidence.push({tmdbId:en.id,title:en.title,officialTrailer:trailer,posterAvailable:checks[0],backdropAvailable:checks[1],trailerOembedAvailable:checks[2],checkedAt:capturedAt});
      console.log(JSON.stringify({event:'candidate_verified',title:en.title,count:movies.length}));
    }
    for(let offset=0;offset<candidates.length&&movies.length<12;offset+=8)await Promise.all(candidates.slice(offset,offset+8).map(consider));
    movies.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    if(movies.length<10)throw new Error('Insufficient bilingual candidates with verified artwork and official trailers.');
    const patch=catalogueModels.map(m=>catalogueGroup(m));patch.find(g=>g.model==='movie')!.rows=movies;
    const shows=patch.find(g=>g.model==='show')!.rows,prices=patch.find(g=>g.model==='showSeatPrice')!.rows;
    const screens=get('screen').filter(s=>get('seat').filter(x=>x.screenId===s.id).length===s.capacity).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    const firstDay=Math.floor((capturedAt.getTime()+330*60000)/86400000)+2;
    for(const [i,movie]of movies.entries()){
      const screen=screens[i%screens.length]!;
      const template=get('show').filter(s=>s.screenId===screen.id).sort((a,b)=>(b.startsAt as Date).getTime()-(a.startsAt as Date).getTime()).find(s=>get('showSeatPrice').filter(p=>p.showId===s.id).length===new Set(get('seat').filter(x=>x.screenId===screen.id).map(x=>x.seatType)).size);
      if(!template)throw new Error('Existing screen has no complete authoritative price template.');
      let startsAt=new Date(firstDay*86400000+510*60000),endsAt=new Date(startsAt.getTime()+Number(movie.durationMinutes)*60000),offset=0;
      while([...get('show'),...shows].some(s=>s.screenId===screen.id&&s.status==='SCHEDULED'&&(s.startsAt as Date)<endsAt&&(s.endsAt as Date)>startsAt)){if(++offset>30)throw new Error('Show overlap found.');startsAt=new Date((firstDay+offset)*86400000+510*60000);endsAt=new Date(startsAt.getTime()+Number(movie.durationMinutes)*60000);}
      const id=stagingId(`enhancement-v1:show:${movie.id}:${screen.id}:${startsAt.toISOString()}`);shows.push({id,movieId:movie.id,screenId:screen.id,startsAt,endsAt,status:'SCHEDULED'});
      for(const p of get('showSeatPrice').filter(p=>p.showId===template.id))prices.push({showId:id,seatType:p.seatType,pricePaise:p.pricePaise});
    }
    const inspected=await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');const fresh=await readCatalogue(tx);if(digest(fresh)!==digest(baseline))throw new Error('Catalogue drift; regenerate preview.');return inspectCatalogue(tx,patch);},{isolationLevel:'RepeatableRead',maxWait:45000,timeout:180000});
    const now=capturedAt.getTime(),report={capturedAt,targetFingerprint:target.fingerprint,baselineHash:digest(baseline),patchHash:digest(patch),toCreate:inspected.createCounts,before:Object.fromEntries(baseline.map(g=>[g.model,g.rows.length])),afterMovieCount:current.length+movies.length,currentFutureShows:get('show').filter(s=>s.status==='SCHEDULED'&&(s.startsAt as Date).getTime()>now).length,currentExpiredShows:get('show').filter(s=>(s.startsAt as Date).getTime()<=now).length,currentFutureEventSessions:get('eventSession').filter(s=>s.status==='SCHEDULED'&&(s.startsAt as Date).getTime()>now).length,currentExpiredEventSessions:get('eventSession').filter(s=>(s.startsAt as Date).getTime()<=now).length,newBookableMovies:movies.length,firstNewShow:shows[0]!.startsAt,lastNewShow:shows.at(-1)!.startsAt,titles:movies.map(m=>m.title),fictionalDemoShows:true,existingMedia:{missingPoster:current.filter(m=>!m.posterUrl).length,missingBackdrop:current.filter(m=>!m.backdropUrl).length,missingHindi:current.filter(m=>!m.descriptionHindi).length,missingTrailer:current.filter(m=>!m.trailerVideoId).length},databaseWrites:0};
    const approvalHash=digest(report);await mkdir(directory,{recursive:true});
    await writeFile(new URL('baseline.json',directory),JSON.stringify(baseline,null,2));await writeFile(new URL('patch.json',directory),JSON.stringify(patch,null,2));await writeFile(new URL('provider-evidence.json',directory),JSON.stringify(evidence,null,2));await writeFile(new URL('preview.json',directory),JSON.stringify({...report,approvalHash},null,2));
    console.log(JSON.stringify({...report,approvalHash}));
  }finally{await db.$disconnect();}
}
main().catch(error=>{console.error(JSON.stringify({event:'enhancement_preview_stopped',phase,prismaCode:typeof error?.code==='string'&&/^P\d{4}$/.test(error.code)?error.code:undefined,...dependencyErrorDetails(error),message:error instanceof Error&&/^(Insufficient|Existing screen|Show overlap|Catalogue drift|TMDB configuration|Preview accepts)/.test(error.message)?error.message:'Read-only preparation failed; provider or target verification unavailable.'}));process.exitCode=1;});
