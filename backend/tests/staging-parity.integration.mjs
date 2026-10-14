import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import dotenv from 'dotenv';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../src/generated/prisma/client.ts';
import {resolveDevTarget} from '../scripts/dev-target.ts';
import {readLocalParitySnapshot} from '../scripts/staging-source.ts';
import {validateParitySnapshot,compareCatalogue,readCatalogue} from '../scripts/staging-parity.ts';
import {inspectCatalogue,applyCatalogue} from '../scripts/staging-catalogue-core.ts';
import {applyContentReview} from '../scripts/staging-content.ts';

// Actual complete source graph, isolated IDs/natural keys, one local transaction, unconditional rollback.
// Never reads .env.staging and never accepts an external database target.
const local=dotenv.parse(await readFile(new URL('../.env',import.meta.url)));
const target=resolveDevTarget(local);let snapshot=await readLocalParitySnapshot();
try{
  const review=JSON.parse(await readFile(new URL('../.staging-parity/content-review.json',import.meta.url),'utf8'));
  const original=snapshot,patched=applyContentReview(snapshot,review);
  for(const group of original.groups)if(group.model!=='movie')assert.deepEqual(patched.snapshot.groups.find(g=>g.model===group.model),group);
  for(const movie of original.groups.find(g=>g.model==='movie').rows)if(movie.ratingValue!=null){
    const next=patched.snapshot.groups.find(g=>g.model==='movie').rows.find(m=>m.id===movie.id);
    for(const field of ['ratingValue','ratingVoteCount','ratingSource','ratingSourceUrl','ratingFetchedAt'])assert.deepEqual(next[field],movie[field]);
  }
  snapshot=patched.snapshot;
}catch(error){if(error.code!=='ENOENT')throw error;}
const marker=randomUUID().slice(0,8), ids=new Map();
for(const g of snapshot.groups)for(const row of g.rows)if(row.id)ids.set(row.id,randomUUID());
for(const g of snapshot.groups)for(const row of g.rows){
  for(const key of Object.keys(row))if(key==='id'||key.endsWith('Id'))row[key]=ids.get(row[key])??row[key];
  if(g.model==='city')row.state+=` parity-${marker}`;
  if(g.model==='movie')row.title=`Parity ${marker} ${row.title}`;
  if(g.model==='event'||g.model==='demoListing')row.slug=`p-${marker}-${row.slug}`;
}
validateParitySnapshot(snapshot);
const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:target.url,max:1,connectionTimeoutMillis:10000,options:'-c timezone=UTC -c statement_timeout=30000'})});
const rollback=new Error('intentional-local-rollback');let complete=false,phase='identity';
try{
  const [identity]=await prisma.$queryRaw`SELECT current_database() AS db,inet_server_port() AS port`;
  assert.equal(identity.db,'cinehook_dev');assert.equal(identity.port,5432);
  const privateCounts=async db=>({users:await db.user.count(),bookings:await db.booking.count(),payments:await db.payment.count(),refunds:await db.refund.count()});
  const before=await privateCounts(prisma),moviesBefore=await prisma.movie.count();
  try{await prisma.$transaction(async tx=>{
    phase='plan';const plan=await inspectCatalogue(tx,snapshot.groups);
    assert.equal(plan.createCounts.movies,77);assert.equal(plan.createCounts.cities,6998);assert.equal(plan.createCounts.screens,8);
    phase='insert';await applyCatalogue(tx,plan);
    phase='SQL constraints';await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
    phase='exact metadata/layout comparison';const comparison=compareCatalogue(snapshot,await readCatalogue(tx));
    assert.ok(Object.values(comparison.models).every(m=>m.missing===0&&m.different===0));
    assert.ok(comparison.layouts.screens.every(s=>s.layoutMatches));assert.ok(comparison.layouts.venues.every(v=>v.layoutMatches));
    phase='repeat';const repeated=await inspectCatalogue(tx,snapshot.groups);
    assert.equal(Object.values(repeated.createCounts).reduce((a,b)=>a+b,0),0);
    await applyCatalogue(tx,repeated);assert.deepEqual(await privateCounts(tx),before);
    complete=true;throw rollback;
  },{timeout:180000,maxWait:10000});}catch(e){if(e!==rollback)throw e;}
  assert.ok(complete);assert.equal(await prisma.movie.count(),moviesBefore);assert.deepEqual(await privateCounts(prisma),before);
  console.log('PASS: complete 77-movie/6998-city local snapshot, actual SQL constraints, exact metadata/layouts/prices, repeat adds zero, private records unchanged, full rollback.');
}catch(e){console.error(JSON.stringify({phase,errorName:e.name,code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:null}));process.exitCode=1;}
finally{await prisma.$disconnect();}
