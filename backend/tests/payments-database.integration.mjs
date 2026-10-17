import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import pg from 'pg';

const url=process.env.AUTH_TEST_DATABASE_URL;
test('PostgreSQL payments: immutable quotes, capture dominance, evidence binding and durable fulfillment conditions', {skip:!url,timeout:30000}, async()=>{
  assert.match(new URL(url).pathname,/_test$/);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname),'Fixture database must be loopback');
  const pool=new pg.Pool({connectionString:url});
  const user=randomUUID(),city=randomUUID(),theatre=randomUUID(),screen=randomUUID(),movie=randomUUID(),show=randomUUID(),seat=randomUUID(),booking=randomUUID(),payment=randomUUID();
  const bookingIds=[booking],paymentIds=[payment];
  const providerPayment=`pay_${randomUUID()}`,order=`order_${randomUUID()}`;
  const tx=async work=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");const result=await work(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}};
  const rejects=async(work,code='23514')=>assert.rejects(work,error=>{assert.equal(error.code,code,error.message);return true;});
  try{
    await pool.query('INSERT INTO users(id,name,email,password_hash,updated_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)',[user,'Payment test',`${user}@example.com`,'integration-only-unusable-hash']);
    await pool.query('INSERT INTO cities(id,name,state,updated_at) VALUES($1,$2,$3,CURRENT_TIMESTAMP)',[city,city,'Test']);
    await pool.query('INSERT INTO theatres(id,name,address,city_id,updated_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)',[theatre,'Payment theatre','Road',city]);
    await pool.query('INSERT INTO screens(id,name,capacity,theatre_id,updated_at) VALUES($1,$2,1,$3,CURRENT_TIMESTAMP)',[screen,'Payment screen',theatre]);
    await pool.query("INSERT INTO movies(id,title,description,duration_minutes,release_date,language,genres,updated_at) VALUES($1,$2,'Test',100,'2026-01-01','english',ARRAY['drama'],CURRENT_TIMESTAMP)",[movie,movie]);
    await tx(async c=>{
      await c.query("INSERT INTO seats(id,screen_id,row_name,seat_number,seat_type) VALUES($1,$2,'A',1,'REGULAR')",[seat,screen]);
      await c.query("INSERT INTO shows(id,movie_id,screen_id,starts_at,ends_at,updated_at) VALUES($1,$2,$3,'2099-01-01T10:00:00Z','2099-01-01T11:40:00Z',CURRENT_TIMESTAMP)",[show,movie,screen]);
      await c.query("INSERT INTO show_seat_prices(show_id,seat_type,price_paise) VALUES($1,'REGULAR',10000)",[show]);
      await c.query("INSERT INTO bookings(id,user_id,show_id,total_paise,expires_at,updated_at) VALUES($1,$2,$3,10000,clock_timestamp()+interval '5 minutes',CURRENT_TIMESTAMP)",[booking,user,show]);
      await c.query('INSERT INTO booking_seats(id,booking_id,show_id,seat_id,price) VALUES($1,$2,$3,$4,10000)',[randomUUID(),booking,show,seat]);
    });
    await pool.query("INSERT INTO payments(id,booking_id,receipt,amount_paise,currency,updated_at) VALUES($1,$2,$3,10000,'INR',CURRENT_TIMESTAMP)",[payment,booking,`r_${randomUUID()}`]);
    await rejects(()=>pool.query('UPDATE payments SET amount_paise=20000 WHERE id=$1',[payment]));
    await rejects(()=>pool.query("UPDATE payments SET currency='USD' WHERE id=$1",[payment]));
    await pool.query('UPDATE payments SET provider_order_id=$2 WHERE id=$1',[payment,order]);
    await rejects(()=>pool.query('UPDATE payments SET provider_order_id=$2 WHERE id=$1',[payment,`${order}_other`]));
    await rejects(()=>pool.query("UPDATE payments SET status='SUCCESS',provider_payment_id=$2,captured_at=clock_timestamp() WHERE id=$1",[payment,providerPayment]));
    await rejects(()=>pool.query("INSERT INTO payment_evidence(provider_payment_id,payment_id,amount_paise,currency,captured,updated_at) VALUES($1,$2,9999,'INR',false,CURRENT_TIMESTAMP)",[providerPayment,payment]));
    await tx(async c=>{
      await c.query("INSERT INTO payment_evidence(provider_payment_id,payment_id,amount_paise,currency,failure_seen,updated_at) VALUES($1,$2,10000,'INR',true,CURRENT_TIMESTAMP)",[providerPayment,payment]);
      await c.query("UPDATE payments SET status='FAILED',failure_code='PROVIDER_FAILED' WHERE id=$1",[payment]);
    });
    await rejects(()=>pool.query('UPDATE payment_evidence SET captured=true WHERE provider_payment_id=$1',[providerPayment]));
    await rejects(()=>tx(async c=>{
      await c.query('UPDATE payment_evidence SET captured=true WHERE provider_payment_id=$1',[providerPayment]);
      await c.query("UPDATE payments SET status='SUCCESS',provider_payment_id=$2,captured_at=clock_timestamp() WHERE id=$1",[payment,providerPayment]);
    }));
    await tx(async c=>{
      await c.query('UPDATE payment_evidence SET captured=true WHERE provider_payment_id=$1',[providerPayment]);
      await c.query("UPDATE payments SET status='SUCCESS',provider_payment_id=$2,captured_at=clock_timestamp() WHERE id=$1",[payment,providerPayment]);
      await c.query("INSERT INTO payment_reconciliations(id,payment_id,reason,compensation_required,updated_at) VALUES($1,$2,'FULFILLMENT_PENDING',false,CURRENT_TIMESTAMP)",[randomUUID(),payment]);
    });
    assert.equal((await pool.query('SELECT status FROM payments WHERE id=$1',[payment])).rows[0].status,'SUCCESS');
    assert.equal((await pool.query('SELECT status FROM bookings WHERE id=$1',[booking])).rows[0].status,'PENDING');
    await rejects(()=>pool.query('UPDATE payment_evidence SET captured=false WHERE provider_payment_id=$1',[providerPayment]));
    await rejects(()=>pool.query("UPDATE payments SET status='FAILED' WHERE id=$1",[payment]));
    await rejects(()=>pool.query('DELETE FROM payment_reconciliations WHERE payment_id=$1',[payment]));
    await tx(async c=>{
      await c.query("UPDATE bookings SET status='FAILED',failure_code='LOCK_EXPIRED' WHERE id=$1",[booking]);
      await c.query("UPDATE payment_reconciliations SET reason='BOOKING_FAILED',compensation_required=true WHERE payment_id=$1",[payment]);
      await c.query('UPDATE payments SET booking_finalized_at=clock_timestamp() WHERE id=$1',[payment]);
    });
    assert.equal((await pool.query('SELECT status FROM payments WHERE id=$1',[payment])).rows[0].status,'SUCCESS');
    await rejects(()=>pool.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[booking]));
    const eventRace=await Promise.allSettled([0,1].map(()=>pool.query("INSERT INTO payment_webhook_events(provider_event_id,digest,event_type,payment_id,provider_payment_id,processed_at) VALUES($1,$2,'payment.captured',$3,$4,clock_timestamp())",[`evt_${payment}`,'a'.repeat(64),payment,providerPayment])));
    assert.equal(eventRace.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(eventRace.find(x=>x.status==='rejected').reason.code,'23505');
    await rejects(()=>pool.query('UPDATE payment_webhook_events SET digest=$2 WHERE provider_event_id=$1',[`evt_${payment}`,'b'.repeat(64)]));
    await rejects(()=>pool.query("UPDATE payment_reconciliations SET reason='FULFILLMENT_PENDING',compensation_required=false WHERE payment_id=$1",[payment]));
    // A fulfilled capture must be rechecked when its booking later changes.
    const fulfilledBook=randomUUID(),fulfilledPayment=randomUUID(),fulfilledCapture=`pay_${randomUUID()}`;
    bookingIds.push(fulfilledBook);paymentIds.push(fulfilledPayment);
    await tx(async c=>{
      await c.query("INSERT INTO bookings(id,user_id,show_id,total_paise,expires_at,updated_at) VALUES($1,$2,$3,10000,clock_timestamp()+interval '5 minutes',CURRENT_TIMESTAMP)",[fulfilledBook,user,show]);
      await c.query('INSERT INTO booking_seats(id,booking_id,show_id,seat_id,price) VALUES($1,$2,$3,$4,10000)',[randomUUID(),fulfilledBook,show,seat]);
      await c.query("INSERT INTO payments(id,booking_id,receipt,amount_paise,provider_order_id,updated_at) VALUES($1,$2,$3,10000,$4,CURRENT_TIMESTAMP)",[fulfilledPayment,fulfilledBook,`r_${randomUUID()}`,`order_${randomUUID()}`]);
      await c.query("INSERT INTO payment_evidence(provider_payment_id,payment_id,amount_paise,captured,updated_at) VALUES($1,$2,10000,true,CURRENT_TIMESTAMP)",[fulfilledCapture,fulfilledPayment]);
      await c.query("UPDATE payments SET status='SUCCESS',provider_payment_id=$2,captured_at=clock_timestamp() WHERE id=$1",[fulfilledPayment,fulfilledCapture]);
      await c.query("INSERT INTO payment_reconciliations(id,payment_id,reason,updated_at) VALUES($1,$2,'FULFILLMENT_PENDING',CURRENT_TIMESTAMP)",[randomUUID(),fulfilledPayment]);
    });
    await rejects(()=>pool.query('INSERT INTO payment_evidence(provider_payment_id,payment_id,amount_paise,updated_at) VALUES($1,$2,10000,CURRENT_TIMESTAMP)',[providerPayment,fulfilledPayment]),'23505');
    await tx(async c=>{
      await c.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[fulfilledBook]);
      await c.query('UPDATE payments SET booking_finalized_at=clock_timestamp() WHERE id=$1',[fulfilledPayment]);
      await c.query('DELETE FROM payment_reconciliations WHERE payment_id=$1',[fulfilledPayment]);
    });
    await rejects(()=>pool.query("UPDATE bookings SET status='CANCELLED' WHERE id=$1",[fulfilledBook]));
    assert.equal((await pool.query('SELECT status FROM bookings WHERE id=$1',[fulfilledBook])).rows[0].status,'CONFIRMED');
    await tx(async c=>{
      await c.query("UPDATE bookings SET status='CANCELLED' WHERE id=$1",[fulfilledBook]);
      await c.query("INSERT INTO payment_reconciliations(id,payment_id,reason,compensation_required,updated_at) VALUES($1,$2,'BOOKING_CANCELLED',true,CURRENT_TIMESTAMP)",[randomUUID(),fulfilledPayment]);
      await c.query("INSERT INTO refunds(id,payment_id,provider_payment_id,amount_paise,reason,updated_at) VALUES($1,$2,$3,10000,'BOOKING_CANCELLED',CURRENT_TIMESTAMP)",[randomUUID(),fulfilledPayment,fulfilledCapture]);
      await c.query("UPDATE payments SET status='REFUND_PENDING' WHERE id=$1",[fulfilledPayment]);
    });
    assert.equal((await pool.query('SELECT status FROM payments WHERE id=$1',[fulfilledPayment])).rows[0].status,'REFUND_PENDING');
    const racedBook=randomUUID(),racedPayment=randomUUID(),racedCapture=`pay_${randomUUID()}`;
    bookingIds.push(racedBook);paymentIds.push(racedPayment);
    await tx(async c=>{
      await c.query("INSERT INTO bookings(id,user_id,show_id,total_paise,expires_at,updated_at) VALUES($1,$2,$3,10000,clock_timestamp()+interval '5 minutes',CURRENT_TIMESTAMP)",[racedBook,user,show]);
      await c.query('INSERT INTO booking_seats(id,booking_id,show_id,seat_id,price) VALUES($1,$2,$3,$4,10000)',[randomUUID(),racedBook,show,seat]);
      await c.query("INSERT INTO payments(id,booking_id,receipt,amount_paise,provider_order_id,updated_at) VALUES($1,$2,$3,10000,$4,CURRENT_TIMESTAMP)",[racedPayment,racedBook,`r_${randomUUID()}`,`order_${randomUUID()}`]);
      await c.query('INSERT INTO payment_evidence(provider_payment_id,payment_id,amount_paise,updated_at) VALUES($1,$2,10000,CURRENT_TIMESTAMP)',[racedCapture,racedPayment]);
    });
    const races=await Promise.allSettled([
      tx(async c=>{
        await c.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE',[racedBook]);
        const current=(await c.query('SELECT status FROM payments WHERE id=$1 FOR UPDATE',[racedPayment])).rows[0].status;
        await c.query('UPDATE payment_evidence SET failure_seen=true WHERE provider_payment_id=$1',[racedCapture]);
        if(current!=='SUCCESS') await c.query("UPDATE payments SET status='FAILED' WHERE id=$1",[racedPayment]);
      }),
      tx(async c=>{
        await c.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE',[racedBook]);
        await c.query('SELECT id FROM payments WHERE id=$1 FOR UPDATE',[racedPayment]);
        await c.query('UPDATE payment_evidence SET captured=true WHERE provider_payment_id=$1',[racedCapture]);
        await c.query("UPDATE payments SET status='SUCCESS',provider_payment_id=$2,captured_at=clock_timestamp() WHERE id=$1",[racedPayment,racedCapture]);
        await c.query("INSERT INTO payment_reconciliations(id,payment_id,reason,updated_at) VALUES($1,$2,'FULFILLMENT_PENDING',CURRENT_TIMESTAMP)",[randomUUID(),racedPayment]);
      }),
    ]);
    assert.equal(races.filter(x=>x.status==='fulfilled').length,2,JSON.stringify(races.map(x=>x.status==='rejected'?{code:x.reason.code,message:x.reason.message}:x.status)));
    assert.equal((await pool.query('SELECT status FROM payments WHERE id=$1',[racedPayment])).rows[0].status,'SUCCESS');
    assert.deepEqual((await pool.query('SELECT captured,failure_seen FROM payment_evidence WHERE provider_payment_id=$1',[racedCapture])).rows[0],{captured:true,failure_seen:true});
    await rejects(()=>tx(async c=>{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.query('UPDATE payments SET updated_at=clock_timestamp() WHERE id=$1',[payment]);}));
  }finally{
    try{
      // This suite's exact IDs only; append-only refund cleanup is confined to
      // the disposable test database validated at setup, never runtime APIs.
      await tx(async c=>{
        await c.query('SET LOCAL session_replication_role=replica');
        await c.query('DELETE FROM refund_attempts WHERE refund_id IN (SELECT id FROM refunds WHERE payment_id=ANY($1::uuid[]))',[paymentIds]);
        await c.query('DELETE FROM refunds WHERE payment_id=ANY($1::uuid[])',[paymentIds]);
        await c.query('DELETE FROM first_booking_offers WHERE user_id=$1',[user]);
      });
      await pool.query('DELETE FROM payments WHERE id=ANY($1::uuid[])',[paymentIds]);
      await pool.query("UPDATE bookings SET status='CANCELLED' WHERE id=ANY($1::uuid[]) AND status='CONFIRMED'",[bookingIds]);
      await pool.query('DELETE FROM bookings WHERE id=ANY($1::uuid[])',[bookingIds]);
      await pool.query('DELETE FROM shows WHERE id=$1',[show]);
      await pool.query('DELETE FROM seats WHERE screen_id=$1',[screen]);
      await pool.query('DELETE FROM screens WHERE id=$1',[screen]);
      await pool.query('DELETE FROM theatres WHERE id=$1',[theatre]);
      await pool.query('DELETE FROM cities WHERE id=$1',[city]);
      await pool.query('DELETE FROM movies WHERE id=$1',[movie]);
      await pool.query('DELETE FROM users WHERE id=$1',[user]);
    }finally{await pool.end();}
  }
});
