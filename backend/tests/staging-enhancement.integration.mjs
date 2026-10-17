import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../src/generated/prisma/client.ts';
import {stagingManifest} from '../scripts/staging-manifest.ts';
import {catalogueModels,catalogueGroup,digest} from '../scripts/staging-shape.ts';
import {readCatalogue} from '../scripts/staging-parity.ts';
import {inspectCatalogue,applyCatalogue,stagingTransactionOptions} from '../scripts/staging-catalogue-core.ts';
import {validateEnhancement} from '../scripts/staging-enhancement-core.ts';

const url=process.env.ENHANCEMENT_TEST_DATABASE_URL;
test('additive enhancement: real constraints, exact replay, unchanged baseline and unconditional rollback',{skip:!url,timeout:120000},async()=>{
  const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55438');assert.equal(target.username,'cinehook_verify');assert.match(target.pathname,/^\/cinehook_final_enhancement_[a-z0-9_]+_test$/);
  const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:url,max:1,options:'-c timezone=UTC'})});
  const rollback=new Error('intentional task-only rollback');let verified=false;
  try{
    const [identity]=await prisma.$queryRaw`SELECT current_database() AS database,current_user AS role,inet_server_port() AS port`;
    assert.equal(identity.database,target.pathname.slice(1));assert.equal(identity.role,'cinehook_verify');assert.equal(identity.port,55438);
    assert.equal(await prisma.movie.count(),0);assert.equal(await prisma.user.count(),0);
    try{await prisma.$transaction(async tx=>{
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");await tx.$executeRaw`SELECT pg_advisory_xact_lock(1667853941,1937006967)`;
      const source=stagingManifest('2099-01-01');await applyCatalogue(tx,await inspectCatalogue(tx,source));
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      const baseline=await readCatalogue(tx),baselineHash=digest(baseline),patch=catalogueModels.map(m=>catalogueGroup(m));
      // Baseline verification above forced deferred integrity guards immediate;
      // restore their normal fresh-transaction mode before the additive insert.
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
      const original=baseline.find(g=>g.model==='movie').rows[0],screen=baseline.find(g=>g.model==='screen').rows[0];
      const template=baseline.find(g=>g.model==='show').rows.find(s=>s.screenId===screen.id);
      const copied=baseline.find(g=>g.model==='showSeatPrice').rows.filter(p=>p.showId===template.id);
      for(let i=0;i<12;i++){
        const id=randomUUID(),showId=randomUUID(),startsAt=new Date(Date.UTC(2099,0,10+i,8,30));
        patch.find(g=>g.model==='movie').rows.push({...original,id,title:`Disposable enhancement ${i}`,descriptionHindi:'केवल परीक्षण कहानी',trailerVideoId:'abcdefghijk',trailerSourceUrl:'https://www.themoviedb.org/movie/1',trailerVerifiedAt:new Date(),artworkKind:'TMDB',artworkSourceUrl:'https://www.themoviedb.org/movie/1',artworkAttribution:'Disposable synthetic test fixture; never published',posterUrl:'https://image.tmdb.org/t/p/w500/test.jpg',backdropUrl:'https://image.tmdb.org/t/p/w1280/test.jpg',ratingValue:5,ratingVoteCount:1,ratingSource:'TMDB',ratingSourceUrl:'https://www.themoviedb.org/movie/1',ratingFetchedAt:new Date()});
        patch.find(g=>g.model==='show').rows.push({id:showId,movieId:id,screenId:screen.id,startsAt,endsAt:new Date(startsAt.getTime()+original.durationMinutes*60000),status:'SCHEDULED'});
        for(const price of copied)patch.find(g=>g.model==='showSeatPrice').rows.push({...price,showId});
      }
      validateEnhancement(baseline,patch,await readCatalogue(tx),new Date());
      const plan=await inspectCatalogue(tx,patch);assert.equal(plan.createCounts.movies,12);assert.equal(plan.createCounts.shows,12);assert.equal(plan.createCounts.showPrices,36);
      await applyCatalogue(tx,plan);await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      const after=await readCatalogue(tx);validateEnhancement(baseline,patch,after,new Date());
      assert.ok(Object.values((await inspectCatalogue(tx,patch)).createCounts).every(n=>n===0));
      const baseOnly=after.map(g=>({...g,rows:g.rows.filter(row=>!patch.find(p=>p.model===g.model).rows.some(p=>digest(g.keys.map(k=>p[k]))===digest(g.keys.map(k=>row[k]))))}));
      assert.equal(digest(baseOnly),baselineHash);assert.equal(await tx.user.count(),0);assert.equal(await tx.booking.count(),0);assert.equal(await tx.payment.count(),0);
      verified=true;throw rollback;
    },stagingTransactionOptions('apply'));}catch(error){if(error!==rollback)throw error;}
    assert.ok(verified);assert.equal(await prisma.movie.count(),0);assert.equal(await prisma.show.count(),0);assert.equal(await prisma.seat.count(),0);
  }finally{await prisma.$disconnect();}
});
