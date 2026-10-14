import { describe, expect, it } from 'vitest';
import { stagingManifest, stagingId } from '../scripts/staging-manifest.js';
import { buildParitySnapshot, decodeParitySnapshot, compareCatalogue, validateParitySnapshot } from '../scripts/staging-parity.js';
import { inspectCatalogue, applyCatalogue } from '../scripts/staging-catalogue-core.js';

const asOf = new Date('2099-10-15T00:00:00Z');
function source() { return stagingManifest('2099-10-15'); }
describe('full catalogue snapshot', () => {
  it('preserves enriched extra movies rather than truncating to the static 30', () => {
    const input = source(), movies = input.find(g => g.model === 'movie')!.rows;
    movies.push({ ...movies[0], id: stagingId('extra-film'), title: 'Enriched extra film',
      descriptionHindi: 'हिंदी विवरण', ratingValue: 8.4, ratingVoteCount: 4312, ratingSource: 'TMDB',
      ratingSourceUrl: 'https://www.themoviedb.org/movie/123', ratingFetchedAt: new Date('2099-10-14T00:00:00Z'),
      trailerVideoId: 'abcdefghijk', trailerSourceUrl: 'https://www.themoviedb.org/movie/123', trailerVerifiedAt: new Date('2099-10-14T00:00:00Z'),
      posterUrl: 'https://image.tmdb.org/t/p/w500/extra.jpg' });
    const snapshot = buildParitySnapshot(input, asOf);
    expect(snapshot.groups.find(g => g.model === 'movie')!.rows).toHaveLength(31);
    expect(snapshot.groups.find(g => g.model === 'movie')!.rows[30]).toMatchObject({title:'Enriched extra film',ratingValue:8.4,ratingVoteCount:4312,descriptionHindi:'हिंदी विवरण',trailerVideoId:'abcdefghijk',posterUrl:'https://image.tmdb.org/t/p/w500/extra.jpg'});
    const restored=decodeParitySnapshot(JSON.stringify(snapshot));
    expect(restored.groups.find(g=>g.model==='movie')!.rows[30]!.ratingFetchedAt).toEqual(new Date('2099-10-14T00:00:00Z'));
  });
  it('excludes expired/cancelled sessions and their prices without shifting dates or changing source rows', () => {
    const input=source(), shows=input.find(g=>g.model==='show')!.rows, prices=input.find(g=>g.model==='showSeatPrice')!.rows;
    shows[0]!.startsAt=new Date('2099-10-14T04:00:00Z');shows[0]!.endsAt=new Date('2099-10-14T06:00:00Z');shows[1]!.status='CANCELLED';
    const before=JSON.stringify(input), snapshot=buildParitySnapshot(input,asOf);
    expect(snapshot.exclusions.show).toMatchObject({expired:1,cancelled:1});
    expect(snapshot.groups.find(g=>g.model==='show')!.rows).toHaveLength(124);
    expect(snapshot.groups.find(g=>g.model==='showSeatPrice')!.rows).toHaveLength(372);
    expect(snapshot.groups.find(g=>g.model==='show')!.rows[0]!.startsAt).toEqual(new Date('2099-10-15T13:30:00Z'));
    expect(prices).toHaveLength(378);expect(JSON.stringify(input)).toBe(before);
  });
  it('rejects private tables, fields, altered snapshot specifications and broken parent links', () => {
    const input=source();
    expect(()=>buildParitySnapshot([...input,{model:'user',rows:[{passwordHash:'secret'}]}] as any,asOf)).toThrow();
    input[1]!.rows[0]!.passwordHash='secret';expect(()=>buildParitySnapshot(input,asOf)).toThrow();
    delete input[1]!.rows[0]!.passwordHash;
    const s=buildParitySnapshot(input,asOf);s.groups[0]!.keys=['passwordHash'];expect(()=>validateParitySnapshot(s)).toThrow();
    input.find(g=>g.model==='seat')!.rows[0]!.screenId=stagingId('missing-screen');expect(()=>buildParitySnapshot(input,asOf)).toThrow();
  });
  it('rejects layout/capacity, overlapping sessions and missing tier-price corruption', () => {
    const a=source();a.find(g=>g.model==='screen')!.rows[0]!.capacity=999;expect(()=>buildParitySnapshot(a,asOf)).toThrow();
    const b=source(), shows=b.find(g=>g.model==='show')!.rows;shows[1]!.startsAt=shows[0]!.startsAt;expect(()=>buildParitySnapshot(b,asOf)).toThrow();
    const c=source();c.find(g=>g.model==='eventSessionPrice')!.rows.pop();expect(()=>buildParitySnapshot(c,asOf)).toThrow();
  });
  it('reports exact metadata and per-screen row/category layout differences, not counts alone', () => {
    const s=buildParitySnapshot(source(),asOf), target=structuredClone(s.groups);
    target.find(g=>g.model==='movie')!.rows[0]!.descriptionHindi='Changed';
    target.find(g=>g.model==='seat')!.rows[0]!.seatType='RECLINER';
    const report=compareCatalogue(s,target);
    expect(report.models.movie).toMatchObject({source:30,target:30,missing:0,different:1,fieldDifferences:{descriptionHindi:1}});
    expect(report.models.seat.different).toBe(1);expect(report.layouts.screens).toHaveLength(6);
    expect(report.layouts.screens[0]).toMatchObject({capacity:48,seats:48,layoutMatches:false});
  });
  it('refuses applying a frozen snapshot once its shows have expired', () => {
    const s=buildParitySnapshot(source(),asOf);
    expect(()=>validateParitySnapshot(s,new Date('2100-01-01T00:00:00Z'))).toThrow(/expired/i);
  });
});

describe('large source-directory inspection',()=>{
  it('queries in bounded batches and detects metadata drift without writing',async()=>{
    const groups=source();groups.find(g=>g.model==='city')!.rows=Array.from({length:7000},(_,i)=>({id:stagingId(`large-city-${i}`),name:`City ${i}`,state:'State',countryCode:'IN'}));
    const calls:number[]=[];let writes=0;
    const tx:any=Object.fromEntries(groups.map(g=>[g.model,{findMany:async({where}:any)=>{calls.push(where.OR.length);return [];},createMany:async()=>{writes++;throw new Error('unexpected write');},count:async()=>0}]));
    const plan=await inspectCatalogue(tx,groups);
    expect(plan.createCounts.cities).toBe(7000);expect(Math.max(...calls)).toBeLessThanOrEqual(400);expect(writes).toBe(0);
    await expect(applyCatalogue(tx,{...plan,groups:[...plan.groups,{model:'user',rows:[]}]} as any)).rejects.toThrow();expect(writes).toBe(0);
  });
});
