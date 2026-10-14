import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';

const url=process.env.AUTH_TEST_DATABASE_URL;
test('PostgreSQL booking: immutable quotes, state transitions, expiry and atomic confirmed-seat allocation', {skip:!url,timeout:45000}, async()=> {
  assert.match(new URL(url).pathname,/_test$/);
  const pool=new pg.Pool({connectionString:url});
  const user=randomUUID(), city=randomUUID(), theatre=randomUUID(), screen=randomUUID(), movie=randomUUID(), show=randomUUID();
  const seat1=randomUUID(), seat2=randomUUID(); const bookingIds=[], showIds=[show];
  const tx=async work=> {
    const c=await pool.connect();
    try { await c.query('BEGIN'); await c.query("SET LOCAL lock_timeout='5s'"); const result=await work(c); await c.query('COMMIT'); return result; }
    catch(error){await c.query('ROLLBACK'); throw error;} finally {c.release();}
  };
  const quote=async (seats=[seat1],total=10000,expires=new Date(Date.now()+300000),price=10000,quoteShow=show)=> {
    const id=randomUUID(); bookingIds.push(id);
    await tx(async c=> {
      await c.query('INSERT INTO bookings(id,user_id,show_id,total_paise,expires_at,updated_at) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)',[id,user,quoteShow,total,expires]);
      for(const seat of seats) await c.query('INSERT INTO booking_seats(id,booking_id,show_id,seat_id,price) VALUES($1,$2,$3,$4,$5)',[randomUUID(),id,quoteShow,seat,price]);
    });
    return id;
  };
  const code=async(work,expected='23514',messagePattern)=>assert.rejects(work,error=>{assert.equal(error.code,expected,error.message);if(messagePattern) assert.match(error.message,messagePattern);return true;});
  try {
    await pool.query('INSERT INTO users(id,name,email,password_hash,updated_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)',[user,'Booking test',`${user}@example.com`,'integration-only-unusable-hash']);
    await pool.query('INSERT INTO cities(id,name,state,updated_at) VALUES($1,$2,$3,CURRENT_TIMESTAMP)',[city,city,'Test']);
    await pool.query('INSERT INTO theatres(id,name,address,city_id,updated_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)',[theatre,'Booking theatre','Road',city]);
    await pool.query('INSERT INTO screens(id,name,capacity,theatre_id,updated_at) VALUES($1,$2,2,$3,CURRENT_TIMESTAMP)',[screen,'Booking screen',theatre]);
    await pool.query("INSERT INTO movies(id,title,description,duration_minutes,release_date,language,genres,updated_at) VALUES($1,$2,'Test',100,'2026-01-01','english',ARRAY['drama'],CURRENT_TIMESTAMP)",[movie,movie]);
    await tx(async c=> {
      await c.query("INSERT INTO seats(id,screen_id,row_name,seat_number,seat_type) VALUES($1,$3,'A',1,'REGULAR'),($2,$3,'A',2,'REGULAR')",[seat1,seat2,screen]);
      await c.query("INSERT INTO shows(id,movie_id,screen_id,starts_at,ends_at,updated_at) VALUES($1,$2,$3,'2099-01-01T10:00:00Z','2099-01-01T11:40:00Z',CURRENT_TIMESTAMP)",[show,movie,screen]);
      await c.query("INSERT INTO show_seat_prices(show_id,seat_type,price_paise) VALUES($1,'REGULAR',10000)",[show]);
    });
    const first=await quote();
    const nearShow=randomUUID(); showIds.push(nearShow);
    const nearStarts=new Date(Date.now()+1500);
    await tx(async c=>{
      await c.query('INSERT INTO shows(id,movie_id,screen_id,starts_at,ends_at,updated_at) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)',[nearShow,movie,screen,nearStarts,new Date(nearStarts.getTime()+100*60000)]);
      await c.query("INSERT INTO show_seat_prices(show_id,seat_type,price_paise) VALUES($1,'REGULAR',10000)",[nearShow]);
    });
    const nearBooking=await quote([seat1],10000,undefined,10000,nearShow);
    // Validation before UPDATE is insufficient when commit crosses show start.
    await code(()=>tx(async c=>{
      await c.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[nearBooking]);
      await c.query('SELECT pg_sleep(1.6)');
    }),'23514',/not bookable before commit/);
    assert.equal((await pool.query('SELECT status FROM bookings WHERE id=$1',[nearBooking])).rows[0].status,'PENDING');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM confirmed_seats WHERE show_id=$1',[nearShow])).rows[0].count,0);
    const firstSeat=(await pool.query('SELECT id FROM booking_seats WHERE booking_id=$1',[first])).rows[0].id;
    await code(()=>pool.query('INSERT INTO confirmed_seats(show_id,seat_id,booking_seat_id) VALUES($1,$2,$3)',[show,seat1,firstSeat]));
    await code(()=>quote([seat1],10001));
    await code(()=>quote([seat1],9999,undefined,9999));
    await code(()=>quote([],10000));
    await code(()=>quote([seat1,seat1],20000),'23505');
    await code(()=>pool.query('UPDATE bookings SET total_paise=20000 WHERE id=$1',[first]));
    await code(()=>pool.query('UPDATE booking_seats SET price=1 WHERE booking_id=$1',[first]));
    await code(()=>pool.query('DELETE FROM booking_seats WHERE booking_id=$1',[first]));
    await code(()=>pool.query("UPDATE shows SET starts_at='2099-01-02T10:00:00Z',ends_at='2099-01-02T11:40:00Z' WHERE id=$1",[show]));
    await code(()=>tx(async c=>{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); await c.query("UPDATE bookings SET status='FAILED' WHERE id=$1",[first]);}));
    const second=await quote();
    const results=await Promise.allSettled([pool.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[first]),pool.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[second])]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(results.find(x=>x.status==='rejected').reason.code,'23505');
    const winner=results[0].status==='fulfilled'?first:second;
    const loser=winner===first?second:first;
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM confirmed_seats WHERE show_id=$1',[show])).rows[0].count,1);
    assert.equal((await pool.query('SELECT status FROM bookings WHERE id=$1',[loser])).rows[0].status,'PENDING');
    await pool.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[winner]);
    const winnerSeat=(await pool.query('SELECT id FROM booking_seats WHERE booking_id=$1',[winner])).rows[0].id;
    // One booking-seat allocation cannot be forged into a second physical seat.
    await code(()=>pool.query('INSERT INTO confirmed_seats(show_id,seat_id,booking_seat_id) VALUES($1,$2,$3)',[show,seat2,winnerSeat]),'23505');
    await code(()=>pool.query('DELETE FROM bookings WHERE id=$1',[winner]));
    await code(()=>pool.query('DELETE FROM confirmed_seats WHERE show_id=$1',[show]));
    await code(()=>pool.query("UPDATE bookings SET status='PENDING' WHERE id=$1",[winner]));
    const multi=await quote([seat1,seat2],20000);
    await code(()=>pool.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[multi]),'23505');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM confirmed_seats WHERE seat_id=$1',[seat2])).rows[0].count,0);
    const confirmedBeforeExpiry=await quote([seat2],10000,new Date(Date.now()+500));
    await pool.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[confirmedBeforeExpiry]);
    const confirmedAt=(await pool.query('SELECT confirmed_at FROM bookings WHERE id=$1',[confirmedBeforeExpiry])).rows[0].confirmed_at;
    await pool.query('SELECT pg_sleep(0.6)');
    await pool.query("UPDATE bookings SET status='CONFIRMED',updated_at=CURRENT_TIMESTAMP WHERE id=$1",[confirmedBeforeExpiry]);
    assert.equal((await pool.query('SELECT confirmed_at FROM bookings WHERE id=$1',[confirmedBeforeExpiry])).rows[0].confirmed_at.toISOString(),confirmedAt.toISOString());
    await pool.query("UPDATE bookings SET status='CANCELLED' WHERE id=$1",[confirmedBeforeExpiry]);
    const expired=await quote([seat2],10000,new Date(Date.now()-1000));
    await code(()=>pool.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[expired]));
    const almostExpired=await quote([seat2],10000,new Date(Date.now()+500));
    await code(()=>tx(async c=>{
      await c.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[almostExpired]);
      await c.query('SELECT pg_sleep(0.6)');
    }),'23514',/hold expired before commit/);
    assert.equal((await pool.query('SELECT status FROM bookings WHERE id=$1',[almostExpired])).rows[0].status,'PENDING');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM confirmed_seats WHERE seat_id=$1',[seat2])).rows[0].count,0);
    await pool.query("UPDATE bookings SET status='FAILED',failure_code='LOCK_EXPIRED' WHERE id=$1",[expired]);
    await code(()=>pool.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[expired]));
    await pool.query('UPDATE show_seat_prices SET price_paise=12000 WHERE show_id=$1',[show]);
    assert.equal((await pool.query('SELECT price FROM booking_seats WHERE booking_id=$1',[winner])).rows[0].price,10000);
    await pool.query("UPDATE bookings SET status='CANCELLED' WHERE id=$1",[winner]);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM confirmed_seats WHERE show_id=$1',[show])).rows[0].count,0);
    await code(()=>pool.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[winner]));
  } finally {
    try {
      // All cleanup targets are this run's fixture IDs, child first.
      await pool.query("UPDATE bookings SET status='CANCELLED' WHERE id=ANY($1::uuid[]) AND status='CONFIRMED'",[bookingIds]);
      await pool.query('DELETE FROM bookings WHERE id=ANY($1::uuid[])',[bookingIds]);
      await pool.query('DELETE FROM shows WHERE id=ANY($1::uuid[])',[showIds]);
      await pool.query('DELETE FROM seats WHERE screen_id=$1',[screen]);
      await pool.query('DELETE FROM screens WHERE id=$1',[screen]);
      await pool.query('DELETE FROM theatres WHERE id=$1',[theatre]);
      await pool.query('DELETE FROM cities WHERE id=$1',[city]);
      await pool.query('DELETE FROM movies WHERE id=$1',[movie]);
      await pool.query('DELETE FROM users WHERE id=$1',[user]);
    } finally {await pool.end();}
  }
});
