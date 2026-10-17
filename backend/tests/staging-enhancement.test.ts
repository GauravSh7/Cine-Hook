import {describe,it,expect} from 'vitest';
import {stagingManifest,stagingId} from '../scripts/staging-manifest.js';
import {catalogueModels,catalogueGroup} from '../scripts/staging-shape.js';
import {enhancementArguments,validateEnhancement,decodeEnhancementGroups} from '../scripts/staging-enhancement-core.js';

function fixture(){
  const baseline=stagingManifest('2030-01-01'),patch=catalogueModels.map(m=>catalogueGroup(m));
  const original=baseline.find(g=>g.model==='movie')!.rows[0]!,screen=baseline.find(g=>g.model==='screen')!.rows[0]!;
  const template=baseline.find(g=>g.model==='show')!.rows.find(s=>s.screenId===screen.id)!;
  for(let i=0;i<12;i++){
    const id=stagingId(`enhancement-test:movie:${i}`),showId=stagingId(`enhancement-test:show:${i}`),startsAt=new Date(Date.UTC(2030,0,10+i,8,30));
    patch.find(g=>g.model==='movie')!.rows.push({...original,id,title:`Enhancement ${i}`,posterUrl:'https://image.tmdb.org/t/p/w500/test.jpg',backdropUrl:'https://image.tmdb.org/t/p/w1280/test.jpg',artworkKind:'TMDB',ratingSource:'TMDB',descriptionHindi:'परीक्षण कहानी',trailerVideoId:'abcdefghijk'});
    patch.find(g=>g.model==='show')!.rows.push({id:showId,movieId:id,screenId:screen.id,startsAt,endsAt:new Date(startsAt.getTime()+Number(original.durationMinutes)*60000),status:'SCHEDULED'});
    for(const price of baseline.find(g=>g.model==='showSeatPrice')!.rows.filter(p=>p.showId===template.id))patch.find(g=>g.model==='showSeatPrice')!.rows.push({...price,showId});
  }
  return {baseline,patch,now:new Date('2029-12-31T00:00:00Z')};
}
describe('bounded additive enhancement',()=>{
  it('defaults to read-only and requires an exact explicit hash for apply',()=>{
    expect(enhancementArguments([]).apply).toBe(false);expect(enhancementArguments(['--dry-run']).apply).toBe(false);
    expect(enhancementArguments(['--apply','--approved-hash','a'.repeat(64)]).apply).toBe(true);
    for(const args of [['--apply'],['--dry-run','--apply'],['--apply','--approved-hash','x'],['--approved-hash','a'.repeat(64)]])expect(()=>enhancementArguments(args)).toThrow();
  });
  it('accepts the unchanged baseline and exact replay without rescheduling',()=>{
    const {baseline,patch,now}=fixture();expect(()=>validateEnhancement(baseline,patch,baseline,now)).not.toThrow();
    const applied=baseline.map(g=>({...g,rows:[...g.rows,...patch.find(p=>p.model===g.model)!.rows]}));
    expect(()=>validateEnhancement(baseline,patch,applied,now)).not.toThrow();
    expect(()=>validateEnhancement(baseline,patch,decodeEnhancementGroups(JSON.parse(JSON.stringify(applied))),now)).not.toThrow();
  });
  it('rejects metadata drift in an old movie and unexpected old inventory changes',()=>{
    const {baseline,patch,now}=fixture(),changed=structuredClone(baseline);changed.find(g=>g.model==='movie')!.rows[0]!.description='Changed';
    expect(()=>validateEnhancement(baseline,patch,changed,now)).toThrow('baseline drift');
    patch.find(g=>g.model==='seat')!.rows.push({...baseline.find(g=>g.model==='seat')!.rows[0]!});expect(()=>validateEnhancement(baseline,patch,baseline,now)).toThrow('scope rejected');
  });
  it('rejects changed previously inserted patch metadata',()=>{
    const {baseline,patch,now}=fixture(),applied=baseline.map(g=>({...g,rows:[...g.rows,...structuredClone(patch.find(p=>p.model===g.model)!.rows)]}));
    applied.find(g=>g.model==='movie')!.rows.at(-1)!.description='Changed';expect(()=>validateEnhancement(baseline,patch,applied,now)).toThrow('existing row differs');
  });
  it('rejects expired new dates and invented prices',()=>{
    const {baseline,patch,now}=fixture();expect(()=>validateEnhancement(baseline,patch,baseline,new Date('2030-02-01'))).toThrow('shows expired');
    patch.find(g=>g.model==='showSeatPrice')!.rows[0]!.pricePaise=123;expect(()=>validateEnhancement(baseline,patch,baseline,now)).toThrow('prices differ');
  });
  it('rejects overlapping shows and Coming Soon additions with bookable shows',()=>{
    const {baseline,patch,now}=fixture(),shows=patch.find(g=>g.model==='show')!.rows;shows[1]!.startsAt=shows[0]!.startsAt;shows[1]!.endsAt=shows[0]!.endsAt;
    expect(()=>validateEnhancement(baseline,patch,baseline,now)).toThrow();
    const fresh=fixture();fresh.patch.find(g=>g.model==='movie')!.rows[0]!.releaseDate=new Date('2031-01-01');expect(()=>validateEnhancement(fresh.baseline,fresh.patch,fresh.baseline,fresh.now)).toThrow('metadata rejected');
  });
});
