import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../dist/app.js';
import { createPrisma } from '../dist/lib/prisma.js';
import { HealthService } from '../dist/modules/health/health.service.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { TokenService } from '../dist/modules/auth/token.service.js';
import { UserRepository } from '../dist/modules/auth/user.repository.js';
import { createCatalog } from '../dist/modules/catalog/create-catalog.js';
import pg from 'pg';

const url = process.env.AUTH_TEST_DATABASE_URL;
test('PostgreSQL shows API: role checks, layout and show races, UTC snapshots, filters and typed pricing', { skip: !url, timeout: 30000 }, async () => {
  assert.match(new URL(url).pathname, /_test$/);
  const prisma = createPrisma(url);
  const run = randomUUID();
  const userId = randomUUID(), cityId = randomUUID(), otherCityId = randomUUID(), theatreId = randomUUID(), screenId = randomUUID(), reclinerScreenId = randomUUID(), movieId=randomUUID();
  const tokens = new TokenService({ secret: 'shows-integration-only-key-1234567890123456789', expiresInSeconds: 3600 });
  const { createShows } = await import('../dist/modules/shows/create-shows.js');
  const app = createApp({ frontendOrigin: 'http://localhost:5173', catalog: createCatalog(prisma),
    shows: createShows(prisma),
    auth: { service: new AuthService(new UserRepository(prisma), tokens), tokens },
    healthService: new HealthService({ checkDatabase: async () => { await prisma.$queryRaw`SELECT 1`; }, checkRedis: async () => {} }) });
  const token = tokens.sign({ userId, role: 'ADMIN' });
  const post = (path, body) => request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
  const patch = (path, body) => request(app).patch(path).set('Authorization', `Bearer ${token}`).send(body);
  try {
    await prisma.user.create({ data: { id: userId, name: 'Shows integration', email: `shows-${run}@example.com`, role: 'ADMIN', passwordHash: 'integration-only-unusable-hash' } });
    await prisma.city.create({ data: { id: cityId, name: `Shows ${run}`, state: 'Test state' } });
    await prisma.city.create({ data: { id: otherCityId, name: `Other shows ${run}`, state: 'Test state' } });
    await prisma.theatre.create({ data: { id: theatreId, name: 'Shows theatre', address: 'Test road', cityId } });
    await prisma.screen.create({ data: { id: screenId, name: 'Shows screen', capacity: 2, theatreId } });
    await prisma.screen.create({ data: { id: reclinerScreenId, name: 'Recliner screen', capacity: 1, theatreId } });
    await prisma.movie.create({data:{id:movieId,title:`API ${run}`,description:'Test',durationMinutes:100,releaseDate:new Date('2026-01-01'),language:'english',genres:['drama']}});
    const path = `/api/admin/screens/${screenId}/seats`;
    const body = { seats: [{ rowName: 'A', seatNumber: 1, seatType: 'REGULAR' }, { rowName: 'A', seatNumber: 2, seatType: 'PREMIUM' }] };
    assert.equal((await request(app).post(path).send(body)).status, 401);
    const layoutRace = await Promise.all([request(app).post(path).set('Authorization', `Bearer ${token}`).send(body), request(app).post(path).set('Authorization', `Bearer ${token}`).send(body)]);
    assert.deepEqual(layoutRace.map(x=>x.status).sort(),[201,409]);
    const result = layoutRace.find(x=>x.status===201);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal((await request(app).post(path).set('Authorization', `Bearer ${token}`).send(body)).status, 409);
    const showBody={movieId,screenId,startsAt:'2099-01-01T15:30:00+05:30',prices:[{seatType:'REGULAR',pricePaise:10000},{seatType:'PREMIUM',pricePaise:15000}]};
    const showRace=await Promise.all([post('/api/admin/shows',showBody),post('/api/admin/shows',showBody)]);
    assert.deepEqual(showRace.map(x=>x.status).sort(),[201,409],JSON.stringify(showRace.map(x=>x.body)));
    assert.equal(showRace.find(x=>x.status===409).body.error.code,'SHOW_OVERLAP');
    const show=showRace.find(x=>x.status===201).body.data.show;
    assert.equal(show.startsAt,'2099-01-01T10:00:00.000Z');
    assert.equal(show.endsAt,'2099-01-01T11:40:00.000Z');
    assert.equal(show.screen.theatre.city.id,cityId);
    assert.equal(show.movie.id,movieId);
    assert.equal(show.prices.length,2);
    assert.equal((await request(app).get(`/api/shows/${show.id}`)).body.data.show.id,show.id);
    const priced=await request(app).get(`/api/shows/${show.id}/seats`);
    assert.equal(priced.status,200);
    assert.equal(priced.body.data.showId,show.id);
    assert.deepEqual(priced.body.data.seats.map(x=>[x.rowName,x.seatNumber,x.seatType,x.pricePaise]),[['A',1,'REGULAR',10000],['A',2,'PREMIUM',15000]]);
    assert.ok(priced.body.data.seats.every(x=>!('availability' in x)&&!('isAvailable' in x)));
    const filtered=await request(app).get('/api/shows').query({movieId,cityId,theatreId,date:'2099-01-01'});
    assert.equal(filtered.status,200);
    assert.deepEqual(filtered.body.data.items.map(x=>x.id),[show.id]);
    assert.equal((await request(app).get('/api/shows').query({movieId,cityId:otherCityId})).body.data.items.length,0);
    const missing=await post('/api/admin/shows',{...showBody,startsAt:'2099-01-02T10:00:00Z',prices:[showBody.prices[0]]});
    assert.equal(missing.status,400);
    assert.equal(missing.body.error.code,'PRICE_COVERAGE');
    for(const response of [await patch(`/api/admin/screens/${screenId}`,{capacity:3}),await patch(`/api/admin/theatres/${theatreId}`,{cityId:otherCityId})]) {
      assert.equal(response.status,409,JSON.stringify(response.body));
      assert.ok(!JSON.stringify(response.body).includes('driverAdapterError'));
      assert.ok(!JSON.stringify(response.body).includes('23514'));
    }
    assert.equal((await patch(`/api/admin/movies/${movieId}`,{durationMinutes:120})).status,200);
    assert.equal((await request(app).get(`/api/shows/${show.id}`)).body.data.show.endsAt,'2099-01-01T11:40:00.000Z');
    assert.equal((await post(`/api/admin/screens/${reclinerScreenId}/seats`,{seats:[{rowName:'R',seatNumber:1,seatType:'RECLINER'}]})).status,201);
    const recliner=await post('/api/admin/shows',{movieId,screenId:reclinerScreenId,startsAt:'2099-01-01T10:00:00Z',prices:[{seatType:'RECLINER',pricePaise:50000}]});
    assert.equal(recliner.status,201,JSON.stringify(recliner.body));
    const reclinerSeats=await request(app).get(`/api/shows/${recliner.body.data.show.id}/seats`);
    assert.equal(reclinerSeats.status,200);
    assert.deepEqual(reclinerSeats.body.data.seats.map(x=>[x.seatType,x.pricePaise]),[['RECLINER',50000]]);
    await prisma.user.update({ where: { id: userId }, data: { role: 'USER' } });
    assert.equal((await request(app).post(path).set('Authorization', `Bearer ${token}`).send(body)).status, 403);
  } finally {
    try {
      // Cleanup is scoped to this run and removes children before parents.
      await prisma.show.deleteMany({where:{screenId:{in:[screenId,reclinerScreenId]}}});
      if (prisma.seat) await prisma.seat.deleteMany({ where: { screenId:{in:[screenId,reclinerScreenId]} } });
      await prisma.screen.deleteMany({ where: { id:{in:[screenId,reclinerScreenId]} } });
      await prisma.theatre.deleteMany({ where: { id: theatreId } });
      await prisma.city.deleteMany({ where: { id:{in:[cityId,otherCityId]} } });
      await prisma.movie.deleteMany({where:{id:movieId}});
      await prisma.user.deleteMany({ where: { id: userId } });
    } finally { await prisma.$disconnect(); }
  }
});

test('PostgreSQL shows: native overlap races, duration snapshot, layout and exact price integrity', { skip: !url, timeout: 45000 }, async () => {
  assert.match(new URL(url).pathname, /_test$/);
  const prisma = createPrisma(url);
  const pool = new pg.Pool({ connectionString: url });
  const run = randomUUID(), cityId = randomUUID(), otherCityId = randomUUID(), theatreId = randomUUID(), otherTheatreId = randomUUID(), screenId = randomUUID(), movieId = randomUUID();
  const start = '2099-01-01T10:00:00Z';
  const transaction = async (work) => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout='5s'"); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  };
  const insertShow = async (client, id, startsAt=start, endsAt='2099-01-01T11:40:00Z', status='SCHEDULED', types=['REGULAR','PREMIUM']) => {
    await client.query('INSERT INTO shows(id,movie_id,screen_id,starts_at,ends_at,status,updated_at) VALUES($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)', [id,movieId,screenId,startsAt,endsAt,status]);
    for (const type of types) await client.query('INSERT INTO show_seat_prices(show_id,seat_type,price_paise) VALUES($1,$2,10000)',[id,type]);
  };
  const rejectsCode = async (operation, code) => {
    await assert.rejects(operation, error => { assert.equal(error.code,code,error.message); return true; });
  };
  const waitForLock = async client => {
    const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    return async () => {
      for (let attempt=0;attempt<100;attempt++) {
        const result=await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
        if(result.rows[0]?.wait_event_type==='Lock') return;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.fail('Expected native writer to wait for its parent row lock');
    };
  };
  try {
    await prisma.city.create({ data: { id:cityId,name:`Native ${run}`,state:'Test state' } });
    await prisma.city.create({ data: { id:otherCityId,name:`Other ${run}`,state:'Test state' } });
    await prisma.theatre.create({ data: { id:theatreId,name:'Native theatre',address:'Road',cityId } });
    await prisma.theatre.create({ data: { id:otherTheatreId,name:'Other theatre',address:'Road',cityId } });
    await prisma.screen.create({ data: { id:screenId,name:'Native screen',capacity:2,theatreId } });
    await prisma.movie.create({ data: { id:movieId,title:`Native ${run}`,description:'Test',durationMinutes:100,releaseDate:new Date('2026-01-01'),language:'english',genres:['drama'] } });
    await rejectsCode(() => transaction(c => insertShow(c,randomUUID())), '23514');
    await rejectsCode(() => pool.query('INSERT INTO seats(id,screen_id,row_name,seat_number,seat_type) VALUES($1,$2,$3,1,$4)',[randomUUID(),screenId,'A','REGULAR']), '23514');
    await rejectsCode(() => pool.query('INSERT INTO seats(id,screen_id,row_name,seat_number,seat_type) VALUES($1,$2,$3,0,$4)',[randomUUID(),screenId,'a','REGULAR']), '23514');
    // Capacity changes waiting behind layout initialization must observe the
    // committed seats, not leave a three-capacity screen with a two-seat layout.
    {
      const initializer=await pool.connect(), capacityWriter=await pool.connect();
      try {
        await initializer.query('BEGIN'); await capacityWriter.query('BEGIN');
        await capacityWriter.query("SET LOCAL lock_timeout='5s'");
        await initializer.query('INSERT INTO seats(id,screen_id,row_name,seat_number,seat_type) VALUES($1,$2,$3,1,$4),($5,$2,$3,2,$6)',[randomUUID(),screenId,'A','REGULAR',randomUUID(),'PREMIUM']);
        const blocked=await waitForLock(capacityWriter);
        const changing=capacityWriter.query('UPDATE screens SET capacity=3 WHERE id=$1',[screenId]).then(()=>null,error=>error);
        await blocked(); await initializer.query('COMMIT');
        assert.equal((await changing).code,'23514');
        await capacityWriter.query('ROLLBACK');
        assert.equal((await pool.query('SELECT capacity FROM screens WHERE id=$1',[screenId])).rows[0].capacity,2);
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM seats WHERE screen_id=$1',[screenId])).rows[0].count,2);
      } finally { await initializer.query('ROLLBACK'); await capacityWriter.query('ROLLBACK'); initializer.release(); capacityWriter.release(); }
    }
    // A stale snapshot must never bypass dependency checks after waiting for a
    // parent lock; protected writers deliberately accept READ COMMITTED only.
    await rejectsCode(()=>transaction(async c=> {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await c.query('SELECT count(*) FROM shows WHERE screen_id=$1',[screenId]);
      await c.query('DELETE FROM seats WHERE screen_id=$1',[screenId]);
    }),'23514');
    // Hold an uncommitted move so scheduling reads the old theatre, then waits
    // for the screen and must reject its changed parent after acquiring it.
    {
      const mover=await pool.connect(), scheduler=await pool.connect();
      try {
        await mover.query('BEGIN'); await scheduler.query('BEGIN');
        await mover.query('UPDATE screens SET theatre_id=$2 WHERE id=$1',[screenId,otherTheatreId]);
        const blocked=await waitForLock(scheduler);
        const scheduling=insertShow(scheduler,randomUUID()).then(()=>null,error=>error);
        await blocked(); await mover.query('COMMIT');
        assert.equal((await scheduling).code,'23514');
        await scheduler.query('ROLLBACK');
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM shows WHERE screen_id=$1',[screenId])).rows[0].count,0);
        await pool.query('UPDATE screens SET theatre_id=$2 WHERE id=$1',[screenId,theatreId]);
      } finally { await mover.query('ROLLBACK'); await scheduler.query('ROLLBACK'); mover.release(); scheduler.release(); }
    }
    // A city move that waits behind the first scheduled show must see that show
    // after its lock resolves and preserve the original city.
    {
      const scheduler=await pool.connect(), mover=await pool.connect(); const showId=randomUUID();
      try {
        await scheduler.query('BEGIN'); await mover.query('BEGIN');
        await insertShow(scheduler,showId);
        const blocked=await waitForLock(mover);
        const moving=mover.query('UPDATE theatres SET city_id=$2 WHERE id=$1',[theatreId,otherCityId]).then(()=>null,error=>error);
        await blocked(); await scheduler.query('COMMIT');
        assert.equal((await moving).code,'23514');
        await mover.query('ROLLBACK');
        assert.equal((await pool.query('SELECT city_id FROM theatres WHERE id=$1',[theatreId])).rows[0].city_id,cityId);
        await prisma.show.delete({where:{id:showId}});
      } finally { await scheduler.query('ROLLBACK'); await mover.query('ROLLBACK'); scheduler.release(); mover.release(); }
    }
    await rejectsCode(()=>transaction(async c=> {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await insertShow(c,randomUUID());
    }),'23514');
    await rejectsCode(()=>transaction(async c=> {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await c.query('UPDATE screens SET capacity=3 WHERE id=$1',[screenId]);
    }),'23514');
    await rejectsCode(()=>transaction(async c=> {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await c.query('UPDATE theatres SET city_id=$2 WHERE id=$1',[theatreId,otherCityId]);
    }),'23514');
    await rejectsCode(() => transaction(c => insertShow(c,randomUUID(),start,'2099-01-01T11:40:00Z','SCHEDULED',['REGULAR'])), '23514');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM shows WHERE screen_id=$1',[screenId])).rows[0].count,0);
    await rejectsCode(() => transaction(c => insertShow(c,randomUUID(),start,'2099-01-01T11:39:00Z')), '23514');
    const firstId=randomUUID(), secondId=randomUUID();
    const outcomes = await Promise.allSettled([transaction(c=>insertShow(c,firstId)),transaction(c=>insertShow(c,secondId))]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'23P01');
    const scheduledId=outcomes[0].status==='fulfilled'?firstId:secondId;
    await rejectsCode(()=>transaction(async c=> {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await c.query('UPDATE show_seat_prices SET price_paise=11000 WHERE show_id=$1',[scheduledId]);
    }),'23514');
    // Adjacent intervals and cancelled records are allowed by the partial exclusion.
    await transaction(c=>insertShow(c,randomUUID(),'2099-01-01T11:40:00Z','2099-01-01T13:20:00Z'));
    await transaction(c=>insertShow(c,randomUUID(),start,'2099-01-01T11:40:00Z','CANCELLED'));
    await rejectsCode(()=>pool.query('UPDATE screens SET capacity=3 WHERE id=$1',[screenId]),'23514');
    await rejectsCode(()=>pool.query('UPDATE screens SET theatre_id=$2 WHERE id=$1',[screenId,otherTheatreId]),'23514');
    await rejectsCode(()=>pool.query('UPDATE theatres SET city_id=$2 WHERE id=$1',[theatreId,otherCityId]),'23514');
    await rejectsCode(()=>pool.query('UPDATE seats SET seat_number=3 WHERE screen_id=$1 AND seat_number=1',[screenId]),'23514');
    await rejectsCode(()=>pool.query('DELETE FROM seats WHERE screen_id=$1',[screenId]),'23514');
    await rejectsCode(()=>pool.query('DELETE FROM show_seat_prices WHERE show_id=$1 AND seat_type=$2',[scheduledId,'PREMIUM']),'23514');
    await rejectsCode(()=>pool.query('INSERT INTO show_seat_prices(show_id,seat_type,price_paise) VALUES($1,$2,1)',[scheduledId,'RECLINER']),'23514');
    await rejectsCode(()=>pool.query('UPDATE show_seat_prices SET price_paise=0 WHERE show_id=$1',[scheduledId]),'23514');
    const snapshot=await prisma.show.findUniqueOrThrow({where:{id:scheduledId}});
    await prisma.movie.update({where:{id:movieId},data:{durationMinutes:110}});
    assert.equal((await prisma.show.findUniqueOrThrow({where:{id:scheduledId}})).endsAt.toISOString(),snapshot.endsAt.toISOString());
    // Ordinary Prisma errors must expose domain/exclusion codes to API translation.
    try { await prisma.screen.update({where:{id:screenId},data:{capacity:3}}); assert.fail('capacity update must fail'); }
    catch(error) { assert.equal(error.code,'P2039'); assert.equal(error.meta?.driverAdapterError?.cause?.originalCode,'23514'); }
    await prisma.movie.update({where:{id:movieId},data:{isActive:false}});
    await rejectsCode(()=>transaction(c=>insertShow(c,randomUUID(),'2099-01-02T10:00:00Z','2099-01-02T11:50:00Z')),'23514');
  } finally {
    try {
      await prisma.show.deleteMany({where:{screenId}});
      await prisma.seat.deleteMany({where:{screenId}});
      await prisma.screen.deleteMany({where:{id:screenId}});
      await prisma.theatre.deleteMany({where:{id:{in:[theatreId,otherTheatreId]}}});
      await prisma.city.deleteMany({where:{id:{in:[cityId,otherCityId]}}});
      await prisma.movie.deleteMany({where:{id:movieId}});
    } finally { await pool.end(); await prisma.$disconnect(); }
  }
});
