import {expect,it} from 'vitest';
import {stagingManifest} from '../scripts/staging-manifest.js';
import {buildParitySnapshot} from '../scripts/staging-parity.js';
import {applyContentReview} from '../scripts/staging-content.js';

function fixture(){const snapshot=buildParitySnapshot(stagingManifest('2099-10-15'),new Date('2099-10-14T00:00:00Z'));
  const movie=snapshot.groups.find(g=>g.model==='movie')!.rows.find(m=>m.title==='Interstellar')!;
  movie.ratingValue=8.49;movie.ratingVoteCount=501;movie.ratingSource='TMDB';movie.ratingSourceUrl='https://www.themoviedb.org/movie/157336';movie.ratingFetchedAt=new Date('2099-10-13T00:00:00Z');
  movie.posterUrl='https://upload.wikimedia.org/wikipedia/en/b/bc/Interstellar_film_poster.jpg';
  const review={version:1,checkedAt:'2099-10-14T01:00:00Z',results:[{movieId:String(movie.id),status:200,provider:{id:157336,title:'Interstellar',original_title:'Interstellar',original_language:'en',release_date:'2014-11-04',vote_average:9,vote_count:900,poster_path:'/originalPoster.jpg',backdrop_path:'/originalBackdrop.jpg'},videos:[{key:'abcdefghijk',name:'Official trailer',official:true,site:'YouTube',type:'Trailer',available:true}]}],wikiRecords:[]};return {snapshot,movie,review};}
it('replaces article-only artwork and restores a verified trailer while preserving existing ratings and every inventory field',()=>{
  const {snapshot,review,movie}=fixture(),before=JSON.stringify(snapshot),result=applyContentReview(snapshot,review);
  const updated=result.snapshot.groups.find(g=>g.model==='movie')!.rows.find(m=>m.id===movie.id)!;
  expect(updated).toMatchObject({posterUrl:'https://image.tmdb.org/t/p/w500/originalPoster.jpg',backdropUrl:'https://image.tmdb.org/t/p/w1280/originalBackdrop.jpg',ratingValue:8.49,ratingVoteCount:501,trailerVideoId:'abcdefghijk',artworkKind:'TMDB'});
  expect(updated.ratingFetchedAt).toEqual(new Date('2099-10-13T00:00:00Z'));expect(JSON.stringify(snapshot)).toBe(before);
  expect(result.snapshot.groups.filter(g=>g.model!=='movie')).toEqual(snapshot.groups.filter(g=>g.model!=='movie'));
});
it('rejects provider identity/title/year/language mismatches and malicious image paths',()=>{
  for(const change of [{id:1},{title:'Different movie',original_title:'Different movie'},{release_date:'2015-11-04'},{original_language:'hi'},{poster_path:'/../../.env'}]){
    const {snapshot,review,movie}=fixture();Object.assign(review.results[0]!.provider,change);const r=applyContentReview(snapshot,review);
    expect(r.snapshot.groups.find(g=>g.model==='movie')!.rows.find(m=>m.id===movie.id)!.posterUrl).toBe(movie.posterUrl);
    expect(r.audit[0]!.matched).toBe(false);
  }
});
it('does not invent a rating for zero-vote or unreleased movies, or use unavailable/unofficial video evidence',()=>{
  const {snapshot,review,movie}=fixture();movie.ratingValue=null;movie.ratingSource=null;movie.releaseDate=new Date('2100-01-01T00:00:00Z');
  review.results[0]!.provider.release_date='2100-01-01';review.results[0]!.provider.vote_count=1;review.results[0]!.provider.vote_average=10;review.results[0]!.videos[0]!.available=false;
  const r=applyContentReview(snapshot,review);const m=r.snapshot.groups.find(g=>g.model==='movie')!.rows.find(m=>m.id===movie.id)!;
  expect(m.ratingValue).toBeNull();expect(m.trailerVideoId).toBeUndefined();
  expect(r.audit.find(a=>a.movieId===movie.id)!.ratingAction).toBe('HELD_UNRELEASED');
});
