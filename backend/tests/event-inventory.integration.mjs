import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import request from 'supertest';
import { createApp } from '../dist/app.js';
import { createPrisma } from '../dist/lib/prisma.js';
import { createCatalog } from '../dist/modules/catalog/create-catalog.js';
import { createEvents } from '../dist/modules/events/create-events.js';
import { HealthService } from '../dist/modules/health/health.service.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { TokenService } from '../dist/modules/auth/token.service.js';
import { UserRepository } from '../dist/modules/auth/user.repository.js';

const url = process.env.EVENT_TEST_DATABASE_URL;
test('native capacity rejects deleting one populated section from a configured two-section venue', { skip: !url, timeout: 30000 }, async () => {
  const target = new URL(url);
  assert.equal(target.hostname,'127.0.0.1'); assert.equal(target.port,'55438'); assert.equal(target.username,'cinehook_verify');
  assert.match(target.pathname,/^\/cinehook_event_inventory_[a-z0-9_]+_test$/);
  const pool = new pg.Pool({ connectionString:url });
  const c = await pool.connect();
  const city=randomUUID(), venue=randomUUID(), sectionA=randomUUID(), sectionB=randomUUID();
  try {
    const identity=(await c.query('SELECT current_user,current_database(),inet_server_port() AS port')).rows[0];
    assert.equal(identity.current_user,'cinehook_verify'); assert.equal(identity.current_database,target.pathname.slice(1)); assert.equal(identity.port,55438);
    await c.query('BEGIN');
    await c.query('INSERT INTO cities(id,name,state,updated_at) VALUES($1,$2,$2,now())',[city,randomUUID()]);
    await c.query("INSERT INTO event_venues(id,city_id,name,address,kind,capacity,updated_at) VALUES($1,$2,'Section deletion regression','Road','AUDITORIUM',2,now())",[venue,city]);
    await c.query("INSERT INTO event_sections(id,venue_id,code,name,position,sort_order) VALUES($1,$3,'A','Section A','FRONT',0),($2,$3,'B','Section B','REAR',1)",[sectionA,sectionB,venue]);
    await c.query("INSERT INTO event_seats(id,section_id,row_name,seat_number,ticket_tier) VALUES($1,$3,'A',1,'STANDARD'),($2,$4,'A',1,'STANDARD')",[randomUUID(),randomUUID(),sectionA,sectionB]);
    await c.query('COMMIT');
    await c.query('BEGIN');
    await c.query('DELETE FROM event_seats WHERE section_id=$1',[sectionA]);
    await c.query('DELETE FROM event_sections WHERE id=$1',[sectionA]);
    await assert.rejects(() => c.query('COMMIT'), e => { assert.equal(e.code,'23514',e.message); return true; });
    await c.query('ROLLBACK');
    assert.equal((await c.query('SELECT count(*)::int AS count FROM event_seats JOIN event_sections ON event_sections.id=event_seats.section_id WHERE venue_id=$1',[venue])).rows[0].count,2);
    assert.equal((await c.query('SELECT count(*)::int AS count FROM event_sections WHERE venue_id=$1',[venue])).rows[0].count,2);
    // Removing the whole unscheduled layout remains a valid unconfigured venue.
    await c.query('BEGIN');
    await c.query('DELETE FROM event_seats WHERE section_id IN ($1,$2)',[sectionA,sectionB]);
    await c.query('DELETE FROM event_sections WHERE venue_id=$1',[venue]);
    await c.query('COMMIT');
    assert.equal((await c.query('SELECT count(*)::int AS count FROM event_sections WHERE venue_id=$1',[venue])).rows[0].count,0);
  } finally { await c.query('ROLLBACK'); c.release(); await pool.end(); }
});

test('native event inventory: identity, coverage, time snapshot and overlap protection', { skip: !url, timeout: 30000 }, async () => {
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55438');
  assert.equal(target.username, 'cinehook_verify'); assert.match(target.pathname, /^\/cinehook_event_inventory_[a-z0-9_]+_test$/);
  const pool = new pg.Pool({ connectionString: url });
  const identity = (await pool.query('SELECT current_user,current_database(),inet_server_port() AS port')).rows[0];
  assert.equal(identity.current_user,'cinehook_verify'); assert.equal(identity.current_database,target.pathname.slice(1)); assert.equal(identity.port,55438);
  const prisma = createPrisma(url);
  const city = randomUUID(), otherCity = randomUUID(), event = randomUUID(), venue = randomUUID(), section = randomUUID(), session = randomUUID();
  const tx = async work => { const c = await pool.connect(); try { await c.query('BEGIN'); await c.query("SET LOCAL lock_timeout='5s'"); await work(c); await c.query('COMMIT'); } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } };
  const rejects = async (work, code = '23514') => assert.rejects(work, e => { assert.equal(e.code, code, e.message); return true; });
  const schedule = async (c, id, start = '2099-01-01T15:30:00+05:30', tiers = ['STANDARD','VIP']) => {
    await c.query('INSERT INTO event_sessions(id,event_id,venue_id,starts_at,updated_at) VALUES($1,$2,$3,$4,now())', [id,event,venue,start]);
    for (const tier of tiers) await c.query('INSERT INTO event_session_prices(session_id,ticket_tier,price_paise) VALUES($1,$2,15000)', [id,tier]);
  };
  try {
    await pool.query('INSERT INTO cities(id,name,state,updated_at) VALUES($1,$3,$3,now()),($2,$4,$4,now())', [city,otherCity,randomUUID(),randomUUID()]);
    await pool.query("INSERT INTO events(id,slug,title,description,kind,duration_minutes,updated_at) VALUES($1,$2,'Comedy','Fictional','EVENTS',90,now())", [event,randomUUID()]);
    await pool.query("INSERT INTO event_venues(id,city_id,name,address,kind,capacity,updated_at) VALUES($1,$2,'Stage','Road','AUDITORIUM',2,now())", [venue,city]);
    await pool.query("INSERT INTO event_sections(id,venue_id,code,name,position,sort_order) VALUES($1,$2,'FRONT','Front','FRONT',0)", [section,venue]);
    await rejects(() => tx(c => schedule(c, randomUUID())));
    await rejects(() => pool.query("INSERT INTO event_seats(id,section_id,row_name,seat_number,ticket_tier) VALUES($1,$2,'A',1,'STANDARD')", [randomUUID(),section]));
    await tx(c => c.query("INSERT INTO event_seats(id,section_id,row_name,seat_number,ticket_tier) VALUES($1,$3,'A',1,'STANDARD'),($2,$3,'A',2,'VIP')", [randomUUID(),randomUUID(),section]));
    await rejects(() => pool.query("INSERT INTO event_seats(id,section_id,row_name,seat_number,ticket_tier) VALUES($1,$2,'A',1,'STANDARD')", [randomUUID(),section]), '23505');
    await rejects(() => tx(c => schedule(c, randomUUID(), undefined, ['STANDARD'])));
    await rejects(() => tx(c => c.query('INSERT INTO event_sessions(id,event_id,venue_id,starts_at,ends_at,updated_at) VALUES($1,$2,$3,$4,$5,now())',
      [randomUUID(),event,venue,'2099-01-01T10:00:00Z','2099-01-01T10:01:00Z'])));
    await tx(c => schedule(c, session));
    await pool.query("INSERT INTO event_performers(event_id,name,biography) VALUES($1,'Nila Sample','Fictional performer biography')", [event]);
    await pool.query("INSERT INTO event_participants(event_id,name) VALUES($1,'Sample team')", [event]);
    const tokens = new TokenService({ secret: 'native-event-tests-12345678901234567890', expiresInSeconds: 3600 });
    const app = createApp({ frontendOrigin: 'http://localhost:5173', catalog: createCatalog(prisma), events: createEvents(prisma),
      healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }),
      auth: { tokens, service: new AuthService(new UserRepository(prisma), tokens) } });
    const listing = await request(app).get(`/api/events?cityId=${city}&kind=EVENTS&search=Comedy`);
    assert.equal(listing.status,200); assert.equal(listing.body.data.items.length,1);
    assert.equal(listing.body.data.items[0].performers[0].biography,'Fictional performer biography');
    assert.equal(listing.body.data.items[0].participants[0].name,'Sample team');
    assert.equal(listing.body.data.items[0].sessions[0].venue.city.id,city);
    assert.equal(listing.body.data.items[0].sessions[0].prices[0].pricePaise,15000);
    assert.equal('bookingAvailable' in listing.body.data.items[0],false);
    assert.equal((await request(app).get(`/api/events?cityId=${otherCity}`)).body.data.items.length,0);
    assert.equal((await request(app).get(`/api/events?cityId=${randomUUID()}`)).status,404);
    assert.equal((await request(app).get(`/api/event-sessions?cityId=${randomUUID()}`)).status,404);
    assert.equal((await request(app).get(`/api/events?search=%25`)).body.data.items.length,0);
    const detail = await request(app).get(`/api/event-sessions/${session}`);
    assert.equal(detail.status,200); assert.equal(detail.body.data.session.venue.sections[0].seats.length,2);
    assert.equal(detail.body.data.session.venue.sections[0].seats[1].ticketTier,'VIP');
    assert.equal((await request(app).get(`/api/event-sessions?eventId=${event}&cityId=${city}`)).body.data.items.length,1);
    assert.equal((await request(app).get(`/api/event-sessions?cityId=${otherCity}`)).body.data.items.length,0);
    assert.equal((await request(app).get(`/api/events/${randomUUID()}`)).status,404);
    const cancelled = randomUUID(), past = randomUUID();
    await tx(async c => {
      await schedule(c,cancelled,'2099-01-05T10:00:00Z');
      await c.query("UPDATE event_sessions SET status='CANCELLED' WHERE id=$1",[cancelled]);
      await schedule(c,past,'2001-01-01T10:00:00Z');
    });
    assert.equal((await request(app).get(`/api/event-sessions/${cancelled}`)).status,404);
    assert.equal((await request(app).get(`/api/event-sessions/${past}`)).status,404);
    assert.equal((await request(app).get(`/api/events/${event}`)).body.data.event.sessions.length,1);
    const snapshot = (await pool.query('SELECT starts_at,ends_at FROM event_sessions WHERE id=$1',[session])).rows[0];
    assert.equal(snapshot.starts_at.toISOString(), '2099-01-01T10:00:00.000Z'); assert.equal(snapshot.ends_at.toISOString(), '2099-01-01T11:30:00.000Z');
    await pool.query('UPDATE events SET duration_minutes=100 WHERE id=$1', [event]);
    assert.equal((await pool.query('SELECT ends_at FROM event_sessions WHERE id=$1',[session])).rows[0].ends_at.toISOString(), '2099-01-01T11:30:00.000Z');
    await rejects(() => tx(c => schedule(c, randomUUID())), '23P01');
    await tx(c => schedule(c, randomUUID(), '2099-01-01T11:30:00Z'));
    for (const query of [
      ['UPDATE event_venues SET city_id=$2 WHERE id=$1',[venue,otherCity]],
      ['UPDATE event_venues SET id=$2 WHERE id=$1',[venue,randomUUID()]],
      ['UPDATE event_venues SET capacity=3 WHERE id=$1',[venue]],
      ['UPDATE event_sections SET id=$2 WHERE id=$1',[section,randomUUID()]],
      ['UPDATE event_sections SET venue_id=$2 WHERE id=$1',[section,randomUUID()]],
      ["UPDATE event_sections SET position='REAR' WHERE id=$1",[section]],
      ["UPDATE event_seats SET seat_number=3 WHERE section_id=$1",[section]],
      ['UPDATE event_seats SET id=$2 WHERE section_id=$1',[section,randomUUID()]],
      ['UPDATE event_seats SET section_id=$2 WHERE section_id=$1',[section,randomUUID()]],
      ['DELETE FROM event_seats WHERE section_id=$1',[section]],
      ['UPDATE events SET id=$2 WHERE id=$1',[event,randomUUID()]],
      ['UPDATE event_sessions SET event_id=$2 WHERE id=$1',[session,randomUUID()]],
      ['UPDATE event_sessions SET venue_id=$2 WHERE id=$1',[session,randomUUID()]],
      ['UPDATE event_sessions SET id=$2 WHERE id=$1',[session,randomUUID()]],
      ['UPDATE event_sessions SET ends_at=ends_at+interval \'1 minute\' WHERE id=$1',[session]],
      ['DELETE FROM event_session_prices WHERE session_id=$1',[session]],
      ['UPDATE event_session_prices SET price_paise=0 WHERE session_id=$1',[session]],
      ["INSERT INTO event_session_prices(session_id,ticket_tier,price_paise) VALUES($1,'PREMIUM',1)",[session]],
    ]) await rejects(() => pool.query(...query));
    await rejects(() => tx(async c => { await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); await schedule(c,randomUUID(),'2099-01-03T10:00:00Z'); }));
    // Exactly one concurrent overlapping session commits; exclusion is permanent authority.
    const outcomes = await Promise.allSettled([tx(c => schedule(c,randomUUID(),'2099-01-04T10:00:00Z')), tx(c => schedule(c,randomUUID(),'2099-01-04T10:00:00Z'))]);
    assert.equal(outcomes.filter(x => x.status==='fulfilled').length,1); assert.equal(outcomes.find(x => x.status==='rejected').reason.code,'23P01');
    await pool.query('UPDATE events SET is_active=false WHERE id=$1',[event]);
    assert.equal((await request(app).get(`/api/events/${event}`)).status,404);
    assert.equal((await request(app).get(`/api/event-sessions/${session}`)).status,404);
    assert.equal((await request(app).get(`/api/events?cityId=${city}`)).body.data.items.length,0);
    assert.equal((await request(app).get(`/api/event-sessions?cityId=${city}`)).body.data.items.length,0);
  } finally { await pool.end(); await prisma.$disconnect(); }
});

test('native venue lock waits cannot bypass layout, capacity or first-session city identity', { skip: !url, timeout: 30000 }, async () => {
  const target = new URL(url);
  assert.equal(target.hostname,'127.0.0.1'); assert.equal(target.port,'55438'); assert.equal(target.username,'cinehook_verify');
  assert.match(target.pathname,/^\/cinehook_event_inventory_[a-z0-9_]+_test$/);
  const pool = new pg.Pool({ connectionString:url });
  const identity = (await pool.query('SELECT current_user,current_database(),inet_server_port() AS port')).rows[0];
  assert.equal(identity.current_user,'cinehook_verify'); assert.equal(identity.current_database,target.pathname.slice(1)); assert.equal(identity.port,55438);
  const city=randomUUID(), otherCity=randomUUID(), event=randomUUID(), venue=randomUUID(), section=randomUUID(), session=randomUUID();
  const waitForLock=async pid => {
    for(let i=0;i<100;i++) {
      if((await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type==='Lock') return;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.fail('Writer must wait for a real native venue row lock');
  };
  const holder=await pool.connect(), writer=await pool.connect();
  const writerPid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  try {
    await pool.query('INSERT INTO cities(id,name,state,updated_at) VALUES($1,$3,$3,now()),($2,$4,$4,now())',[city,otherCity,randomUUID(),randomUUID()]);
    await pool.query("INSERT INTO events(id,slug,title,description,kind,duration_minutes,updated_at) VALUES($1,$2,'Native race','Fictional','EVENTS',60,now())",[event,randomUUID()]);
    await pool.query("INSERT INTO event_venues(id,city_id,name,address,kind,capacity,updated_at) VALUES($1,$2,'Native stage','Road','AUDITORIUM',1,now())",[venue,city]);
    await pool.query("INSERT INTO event_sections(id,venue_id,code,name,position,sort_order) VALUES($1,$2,'FRONT','Front','FRONT',0)",[section,venue]);
    await holder.query('BEGIN'); await writer.query('BEGIN'); await writer.query("SET LOCAL lock_timeout='5s'");
    await holder.query("INSERT INTO event_seats(id,section_id,row_name,seat_number,ticket_tier) VALUES($1,$2,'A',1,'STANDARD')",[randomUUID(),section]);
    const changing=writer.query('UPDATE event_venues SET capacity=2 WHERE id=$1',[venue]).then(()=>null,e=>e);
    await waitForLock(writerPid); await holder.query('COMMIT'); assert.equal((await changing).code,'23514'); await writer.query('ROLLBACK');
    await holder.query('BEGIN'); await writer.query('BEGIN');
    await holder.query('INSERT INTO event_sessions(id,event_id,venue_id,starts_at,updated_at) VALUES($1,$2,$3,$4,now())',[session,event,venue,'2099-01-01T10:00:00Z']);
    await holder.query("INSERT INTO event_session_prices(session_id,ticket_tier,price_paise) VALUES($1,'STANDARD',10000)",[session]);
    const moving=writer.query('UPDATE event_venues SET city_id=$2 WHERE id=$1',[venue,otherCity]).then(()=>null,e=>e);
    await waitForLock(writerPid); await holder.query('COMMIT'); assert.equal((await moving).code,'23514'); await writer.query('ROLLBACK');
    assert.equal((await pool.query('SELECT city_id,capacity FROM event_venues WHERE id=$1',[venue])).rows[0].city_id,city);
    assert.equal((await pool.query('SELECT capacity FROM event_venues WHERE id=$1',[venue])).rows[0].capacity,1);
    await holder.query('BEGIN'); await writer.query('BEGIN');
    await holder.query('SELECT id FROM event_venues WHERE id=$1 FOR UPDATE',[venue]);
    const layout=writer.query("UPDATE event_sections SET position='REAR' WHERE id=$1",[section]).then(()=>null,e=>e);
    await waitForLock(writerPid); await holder.query('COMMIT'); assert.equal((await layout).code,'23514'); await writer.query('ROLLBACK');
  } finally { await holder.query('ROLLBACK'); await writer.query('ROLLBACK'); holder.release(); writer.release(); await pool.end(); }
});
