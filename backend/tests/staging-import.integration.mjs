import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { resolveDevTarget } from '../scripts/dev-target.ts';
import { stagingManifest } from '../scripts/staging-manifest.ts';
import { inspectCatalogue, applyCatalogue } from '../scripts/staging-catalogue-core.ts';
import { createCatalog } from '../src/modules/catalog/create-catalog.ts';
import { createShows } from '../src/modules/shows/create-shows.ts';
import { createEvents } from '../src/modules/events/create-events.ts';
import { dependencyErrorDetails } from '../src/lib/dependency-diagnostics.ts';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { AuthService } from '../src/modules/auth/auth.service.ts';
import { TokenService } from '../src/modules/auth/token.service.ts';
import { HealthService } from '../src/modules/health/health.service.ts';
import { DemoCatalogService } from '../src/modules/demo-catalog/demo-catalog.service.ts';
import { DemoCatalogRepository } from '../src/modules/demo-catalog/demo-catalog.repository.ts';

// Explicit local rollback test. This file never accepts Neon or production URLs.
dotenv.config({quiet:true});
const target=resolveDevTarget(process.env);
const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:target.url,max:1,connectionTimeoutMillis:10000,options:'-c timezone=UTC -c statement_timeout=30000'})});
const rollback=new Error('staging-test-rollback'), marker=randomUUID();
const manifest=stagingManifest('2099-10-15');
for(const group of manifest) for(const row of group.rows){
  if(group.model==='movie')row.title=`Staging validation ${marker} ${row.title}`;
  if(group.model==='city')row.state=`${row.state} ${marker}`;
}
let assertionsPassed=false;
let phase='connection';
try {
  const identity=await prisma.$queryRaw`SELECT current_database() AS name,inet_server_port() AS port`;
  assert.equal(identity[0].name,'cinehook_dev');assert.equal(identity[0].port,5432);
  const before={movies:await prisma.movie.count(),users:await prisma.user.count(),bookings:await prisma.booking.count(),payments:await prisma.payment.count()};
  try {
    await prisma.$transaction(async tx=>{
      phase='inspection';
      const plan=await inspectCatalogue(tx,manifest);
      assert.equal(plan.createCounts.movies,30);
      assert.equal(plan.createCounts.seats,576);
      phase='insertion';
      const traced=new Proxy(tx,{get(target,key){
        const delegate=target[key];
        if(manifest.some(group=>group.model===key))return new Proxy(delegate,{get(model,method){
          if(method==='createMany')return (...args)=>{phase=`insertion:${key}`;return model.createMany(...args);};
          return model[method];
        }});
        return delegate;
      }});
      await applyCatalogue(traced,plan);
      // Force deferred database checks now: capacity, parent relationships and prices.
      phase='constraints';await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      phase='repeat';const repeated=await inspectCatalogue(tx,manifest);
      assert.equal(Object.values(repeated.createCounts).reduce((a,b)=>a+b,0),0);
      const city=manifest.find(g=>g.model==='city').rows[0],film=manifest.find(g=>g.model==='movie').rows[0];
      const catalog=createCatalog(tx),shows=createShows(tx),events=createEvents(tx);
      const movie=await catalog.movies.getById(film.id,city.id);
      assert.equal(movie.bookingAvailability.hasShows,true);
      const theatres=await catalog.theatres.list({cityId:city.id,page:1,limit:20});assert.ok(theatres.items.length);
      const dates=await catalog.movies.showDates(film.id,city.id);assert.ok(dates.dates.length);
      const dbShows=await tx.show.findMany({where:{screen:{theatre:{cityId:city.id}}},include:{prices:true}});
      assert.equal(dbShows.length,42);assert.ok(dbShows.every(show=>show.prices.length===3));
      const eventRows=await tx.event.findMany({where:{id:{in:manifest.find(g=>g.model==='event').rows.map(row=>row.id)}},include:{sessions:{include:{prices:true}}}});
      assert.equal(eventRows.length,9);assert.ok(eventRows.every(event=>event.sessions.length===7&&event.sessions.every(session=>session.prices.length===3)));
      phase='HTTP catalogue reads';
      const tokens=new TokenService({secret:'staging-verification-only-token-secret-123456',expiresInSeconds:3600});
      const auth=new AuthService({findById:async()=>null,findByEmail:async()=>null,create:async()=>{throw new Error('No user writes allowed');}},tokens);
      const app=createApp({frontendOrigin:'http://localhost:5173',catalog,shows,events,auth:{service:auth,tokens},
        healthService:new HealthService({checkDatabase:async()=>{},checkRedis:async()=>{}}),
        demoCatalog:new DemoCatalogService(new DemoCatalogRepository(tx)),catalogueStage:{databaseUrl:target.url,staging:true}});
      const show=dbShows[0],event=eventRows[0];
      for(const path of ['/api/cities',`/api/movies?cityId=${city.id}`,`/api/movies/${film.id}?cityId=${city.id}`,
        `/api/theatres?cityId=${city.id}`,`/api/shows?cityId=${city.id}`,`/api/movies/${film.id}/show-dates?cityId=${city.id}`,
        `/api/shows/${show.id}/seats`, `/api/events?kind=SPORTS&cityId=${city.id}`,`/api/events/${event.id}`,
        '/api/demo-catalog/stream','/api/demo-catalog/events','/api/demo-catalog/sports','/api/demo-catalog/activities','/api/catalogue/status']) {
        const response=await request(app).get(path);assert.equal(response.status,200,path);
        if(response.body.data.items)assert.ok(response.body.data.items.length,path);
      }
      assert.equal((await request(app).get('/api/catalogue/status')).body.data.newPaymentsAllowed,false);
      assert.equal(await tx.user.count(),before.users);assert.equal(await tx.booking.count(),before.bookings);assert.equal(await tx.payment.count(),before.payments);
      assertionsPassed=true;
      throw rollback;
    },{maxWait:10000,timeout:180000});
  }catch(error){if(error!==rollback)throw error;}
  assert.equal(assertionsPassed,true);
  assert.deepEqual({movies:await prisma.movie.count(),users:await prisma.user.count(),bookings:await prisma.booking.count(),payments:await prisma.payment.count()},before);
  console.log('PASS: real PostgreSQL constraints, idempotency, city/movie/show reads, event sessions/prices, private table preservation and full rollback.');
}catch(error){console.error('Local staging integration failed:',JSON.stringify({phase,...dependencyErrorDetails(error),prismaCode:/^P\d{4}$/.test(error?.code)?error.code:undefined}));process.exitCode=1;}
finally{await prisma.$disconnect();}
