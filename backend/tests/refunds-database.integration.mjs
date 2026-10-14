import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import pg from 'pg';

const url=process.env.AUTH_TEST_DATABASE_URL;

test('PostgreSQL refunds: capture binding, monotonic evidence, cancellation release and commit cutoff', {skip:!url,timeout:60000}, async t=>{
  assert.match(new URL(url).pathname,/_test$/);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname),'Fixture database must be loopback');
  const pool=new pg.Pool({connectionString:url});
  const ids={user:randomUUID(),city:randomUUID(),theatre:randomUUID(),screen:randomUUID(),movie:randomUUID(),show:randomUUID(),seat:randomUUID(),seat2:randomUUID()};
  const bookings=[],payments=[],shows=[ids.show];
  const tx=async work=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");const result=await work(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
  const rejects=async(work,code='23514',message)=>assert.rejects(work,e=>{assert.equal(e.code,code,e.message);if(message)assert.match(e.message,message);return true;});
  const fixture=async({show=ids.show,seat=ids.seat,confirmed=true}={})=>{
    const booking=randomUUID(),payment=randomUUID(),capture=`pay_${randomUUID()}`,seatQuote=randomUUID();
    bookings.push(booking);payments.push(payment);
    await tx(async c=>{
      await c.query("INSERT INTO bookings(id,user_id,show_id,total_paise,expires_at,updated_at) VALUES($1,$2,$3,10000,clock_timestamp()+interval '5 minutes',CURRENT_TIMESTAMP)",[booking,ids.user,show]);
      await c.query('INSERT INTO booking_seats(id,booking_id,show_id,seat_id,price) VALUES($1,$2,$3,$4,10000)',[seatQuote,booking,show,seat]);
      await c.query("INSERT INTO payments(id,booking_id,receipt,amount_paise,provider_order_id,updated_at) VALUES($1,$2,$3,10000,$4,CURRENT_TIMESTAMP)",[payment,booking,randomUUID(),`order_${randomUUID()}`]);
      await c.query('INSERT INTO payment_evidence(provider_payment_id,payment_id,amount_paise,captured,updated_at) VALUES($1,$2,10000,true,CURRENT_TIMESTAMP)',[capture,payment]);
      await c.query("UPDATE payments SET status='SUCCESS',provider_payment_id=$2,captured_at=clock_timestamp() WHERE id=$1",[payment,capture]);
      if(confirmed){
        await c.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[booking]);
        await c.query('UPDATE payments SET booking_finalized_at=clock_timestamp() WHERE id=$1',[payment]);
      }else{
        await c.query("UPDATE bookings SET status='FAILED' WHERE id=$1",[booking]);
        await c.query('UPDATE payments SET booking_finalized_at=clock_timestamp() WHERE id=$1',[payment]);
        await c.query("INSERT INTO payment_reconciliations(id,payment_id,reason,compensation_required,updated_at) VALUES($1,$2,'BOOKING_FAILED',true,CURRENT_TIMESTAMP)",[randomUUID(),payment]);
      }
    });
    return {booking,payment,capture,seatQuote};
  };
  const refund=async(c,f,capture=f.capture)=>{
    const id=randomUUID();
    await c.query("INSERT INTO refunds(id,payment_id,provider_payment_id,amount_paise,reason,updated_at) VALUES($1,$2,$3,10000,'BOOKING_CANCELLED',CURRENT_TIMESTAMP)",[id,f.payment,capture]);
    return id;
  };
  const cancel=async f=>tx(async c=>{
    await c.query("UPDATE bookings SET status='CANCELLED' WHERE id=$1",[f.booking]);
    const id=await refund(c,f);
    await c.query("UPDATE payments SET status='REFUND_PENDING' WHERE id=$1",[f.payment]);
    await c.query("INSERT INTO payment_reconciliations(id,payment_id,reason,compensation_required,updated_at) VALUES($1,$2,'BOOKING_CANCELLED',true,CURRENT_TIMESTAMP) ON CONFLICT(payment_id) DO UPDATE SET reason='BOOKING_CANCELLED',compensation_required=true,resolved_at=NULL,updated_at=CURRENT_TIMESTAMP",[randomUUID(),f.payment]);
    return id;
  });
  try{
    await pool.query('INSERT INTO users(id,name,email,password_hash,updated_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)',[ids.user,'Refund test',`${ids.user}@example.com`,'integration-only-unusable-hash']);
    await pool.query('INSERT INTO cities(id,name,state,updated_at) VALUES($1,$2,$3,CURRENT_TIMESTAMP)',[ids.city,ids.city,'Test']);
    await pool.query('INSERT INTO theatres(id,name,address,city_id,updated_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)',[ids.theatre,'Refund theatre','Road',ids.city]);
    await pool.query('INSERT INTO screens(id,name,capacity,theatre_id,updated_at) VALUES($1,$2,2,$3,CURRENT_TIMESTAMP)',[ids.screen,'Refund screen',ids.theatre]);
    await pool.query("INSERT INTO movies(id,title,description,duration_minutes,release_date,language,genres,updated_at) VALUES($1,$2,'Test',100,'2026-01-01','english',ARRAY['drama'],CURRENT_TIMESTAMP)",[ids.movie,ids.movie]);
    await tx(async c=>{
      await c.query("INSERT INTO seats(id,screen_id,row_name,seat_number,seat_type) VALUES($1,$3,'A',1,'REGULAR'),($2,$3,'A',2,'REGULAR')",[ids.seat,ids.seat2,ids.screen]);
      await c.query("INSERT INTO shows(id,movie_id,screen_id,starts_at,ends_at,updated_at) VALUES($1,$2,$3,'2099-01-01T10:00:00Z','2099-01-01T11:40:00Z',CURRENT_TIMESTAMP)",[ids.show,ids.movie,ids.screen]);
      await c.query("INSERT INTO show_seat_prices(show_id,seat_type,price_paise) VALUES($1,'REGULAR',10000)",[ids.show]);
    });
    await t.test('full captured source is required, cancellation rolls back all effects on invalid refund',async()=>{
      const f=await fixture();
      await rejects(()=>tx(async c=>{
        await c.query("UPDATE bookings SET status='CANCELLED' WHERE id=$1",[f.booking]);
        await c.query("INSERT INTO payment_reconciliations(id,payment_id,reason,compensation_required,updated_at) VALUES($1,$2,'BOOKING_CANCELLED',true,CURRENT_TIMESTAMP)",[randomUUID(),f.payment]);
      }));
      await rejects(()=>tx(async c=>{
        await c.query("UPDATE bookings SET status='CANCELLED' WHERE id=$1",[f.booking]);
        await c.query("INSERT INTO refunds(id,payment_id,provider_payment_id,amount_paise,reason,updated_at) VALUES($1,$2,$3,9999,'BOOKING_CANCELLED',CURRENT_TIMESTAMP)",[randomUUID(),f.payment,f.capture]);
      }));
      assert.equal((await pool.query('SELECT status FROM bookings WHERE id=$1',[f.booking])).rows[0].status,'CONFIRMED');
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM confirmed_seats WHERE booking_seat_id=$1',[f.seatQuote])).rows[0].n,1);
      const id=await cancel(f);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM confirmed_seats WHERE booking_seat_id=$1',[f.seatQuote])).rows[0].n,0);
      assert.equal((await pool.query('SELECT price FROM booking_seats WHERE id=$1',[f.seatQuote])).rows[0].price,10000);
      await rejects(()=>pool.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[f.booking]));
      await rejects(()=>pool.query('UPDATE refunds SET amount_paise=9999 WHERE id=$1',[id]));
      await rejects(()=>pool.query('DELETE FROM refunds WHERE id=$1',[id]));
      await rejects(()=>pool.query("UPDATE payments SET status='SUCCESS' WHERE id=$1",[f.payment]));
      await rejects(()=>pool.query('UPDATE payments SET captured_at=clock_timestamp() WHERE id=$1',[f.payment]));
      await rejects(()=>pool.query('UPDATE payment_evidence SET captured=false WHERE provider_payment_id=$1',[f.capture]));
      await rejects(()=>pool.query("UPDATE refunds SET status='REFUNDED' WHERE id=$1",[id]));
      const attempt=randomUUID(),providerRefund=`rfnd_${randomUUID()}`;
      await pool.query("INSERT INTO refund_attempts(id,refund_id,sequence,receipt,updated_at) VALUES($1,$2,1,$3,CURRENT_TIMESTAMP)",[attempt,id,randomUUID()]);
      await rejects(()=>pool.query("UPDATE refund_attempts SET status='PROCESSED' WHERE id=$1",[attempt]));
      await tx(async c=>{
        await c.query("UPDATE refund_attempts SET status='PROCESSED',provider_refund_id=$2,processed_at=clock_timestamp() WHERE id=$1",[attempt,providerRefund]);
        await c.query("UPDATE refunds SET status='REFUNDED' WHERE id=$1",[id]);
        await c.query("UPDATE payments SET status='REFUNDED' WHERE id=$1",[f.payment]);
        await c.query('UPDATE payment_reconciliations SET resolved_at=clock_timestamp() WHERE payment_id=$1',[f.payment]);
      });
      await rejects(()=>pool.query("UPDATE refund_attempts SET status='FAILED' WHERE id=$1",[attempt]));
      await rejects(()=>pool.query('INSERT INTO refund_attempts(id,refund_id,sequence,receipt,updated_at) VALUES($1,$2,2,$3,CURRENT_TIMESTAMP)',[randomUUID(),id,randomUUID()]));
      await rejects(()=>pool.query('UPDATE refund_attempts SET provider_refund_id=$2 WHERE id=$1',[attempt,`${providerRefund}_other`]));
      await rejects(()=>pool.query("UPDATE refunds SET status='PENDING' WHERE id=$1",[id]));
      await rejects(()=>pool.query("UPDATE payments SET status='SUCCESS' WHERE id=$1",[f.payment]));
      await rejects(()=>pool.query("UPDATE payments SET status='REFUND_PENDING' WHERE id=$1",[f.payment]));
      await pool.query("INSERT INTO payment_webhook_events(provider_event_id,digest,event_type,payment_id,provider_payment_id,provider_refund_id,processed_at) VALUES($1,$2,'refund.processed',$3,$4,$5,clock_timestamp())",[`evt_${attempt}`,'a'.repeat(64),f.payment,f.capture,providerRefund]);
      await rejects(()=>pool.query('UPDATE payment_webhook_events SET provider_refund_id=$2 WHERE provider_event_id=$1',[`evt_${attempt}`,`${providerRefund}_other`]));
      // A distinct later capture creates fresh compensation and reopens progress.
      const extra=`pay_${randomUUID()}`;
      await tx(async c=>{
        await c.query('INSERT INTO payment_evidence(provider_payment_id,payment_id,amount_paise,captured,updated_at) VALUES($1,$2,10000,true,CURRENT_TIMESTAMP)',[extra,f.payment]);
        await c.query("UPDATE payments SET status='REFUND_PENDING' WHERE id=$1",[f.payment]);
        await c.query('UPDATE payment_reconciliations SET resolved_at=NULL WHERE payment_id=$1',[f.payment]);
      });
      await rejects(()=>pool.query("UPDATE payments SET status='REFUNDED' WHERE id=$1",[f.payment]));
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM refunds WHERE provider_payment_id=$1',[extra])).rows[0].n,0);
      await tx(c=>refund(c,f,extra));
      await rejects(()=>tx(async c=>{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.query('UPDATE refunds SET updated_at=clock_timestamp() WHERE id=$1',[id]);}));
      const next=await fixture();
      await cancel(next);
    });
    await t.test('extra captures refund individually while the confirmed funding remains SUCCESS',async()=>{
      const f=await fixture(),extra=`pay_${randomUUID()}`;
      await tx(async c=>{
        await c.query('INSERT INTO payment_evidence(provider_payment_id,payment_id,amount_paise,captured,updated_at) VALUES($1,$2,10000,true,CURRENT_TIMESTAMP)',[extra,f.payment]);
        await c.query("INSERT INTO payment_reconciliations(id,payment_id,reason,compensation_required,updated_at) VALUES($1,$2,'EXTRA_CAPTURE',true,CURRENT_TIMESTAMP)",[randomUUID(),f.payment]);
      });
      await rejects(()=>tx(c=>refund(c,f)));
      const extraRefund=await tx(c=>refund(c,f,extra));
      const a=randomUUID(),p=`rfnd_${randomUUID()}`;
      await tx(async c=>{
        await c.query("INSERT INTO refund_attempts(id,refund_id,sequence,receipt,provider_refund_id,status,processed_at,updated_at) VALUES($1,$2,1,$3,$4,'PROCESSED',clock_timestamp(),CURRENT_TIMESTAMP)",[a,extraRefund,randomUUID(),p]);
        await c.query("UPDATE refunds SET status='REFUNDED' WHERE id=$1",[extraRefund]);
      });
      assert.equal((await pool.query('SELECT status FROM payments WHERE id=$1',[f.payment])).rows[0].status,'SUCCESS');
      await rejects(()=>pool.query("UPDATE payments SET status='REFUNDED' WHERE id=$1",[f.payment]));
      await cancel(f);
    });
    await t.test('provider refund identity is globally bound and retries require a failed current attempt',async()=>{
      const f=await fixture({confirmed:false}),id=await tx(c=>refund(c,f)),a=randomUUID(),p=`rfnd_${randomUUID()}`;
      const uncaptured=`pay_${randomUUID()}`;
      await pool.query('INSERT INTO payment_evidence(provider_payment_id,payment_id,amount_paise,updated_at) VALUES($1,$2,10000,CURRENT_TIMESTAMP)',[uncaptured,f.payment]);
      await rejects(()=>tx(c=>refund(c,f,uncaptured)));
      await pool.query("INSERT INTO refund_attempts(id,refund_id,sequence,receipt,provider_refund_id,updated_at) VALUES($1,$2,1,$3,$4,CURRENT_TIMESTAMP)",[a,id,randomUUID(),p]);
      await rejects(()=>pool.query('INSERT INTO refund_attempts(id,refund_id,sequence,receipt,updated_at) VALUES($1,$2,2,$3,CURRENT_TIMESTAMP)',[randomUUID(),id,randomUUID()]));
      await pool.query("UPDATE refund_attempts SET status='FAILED' WHERE id=$1",[a]);
      const races=await Promise.allSettled([0,1].map(()=>pool.query('INSERT INTO refund_attempts(id,refund_id,sequence,receipt,updated_at) VALUES($1,$2,2,$3,CURRENT_TIMESTAMP)',[randomUUID(),id,randomUUID()])));
      assert.equal(races.filter(x=>x.status==='fulfilled').length,1);
      const other=await fixture({confirmed:false}),otherRefund=await tx(c=>refund(c,other));
      await rejects(()=>tx(c=>refund(c,other,f.capture)));
      await rejects(()=>pool.query('INSERT INTO refund_attempts(id,refund_id,sequence,receipt,provider_refund_id,updated_at) VALUES($1,$2,1,$3,$4,CURRENT_TIMESTAMP)',[randomUUID(),otherRefund,randomUUID(),p]),'23505');
      await rejects(()=>pool.query('UPDATE refunds SET provider_payment_id=$2 WHERE id=$1',[otherRefund,f.capture]));
    });
    await t.test('cancellation is rejected when locks or commit carry it to show start; compensation still works',async()=>{
      const near=randomUUID();shows.push(near);
      await tx(async c=>{
        await c.query("INSERT INTO shows(id,movie_id,screen_id,starts_at,ends_at,updated_at) SELECT $1,$2,$3,s,s+interval '100 minutes',CURRENT_TIMESTAMP FROM (SELECT date_trunc('milliseconds',clock_timestamp())+interval '3 seconds' AS s) x",[near,ids.movie,ids.screen]);
        await c.query("INSERT INTO show_seat_prices(show_id,seat_type,price_paise) VALUES($1,'REGULAR',10000)",[near]);
      });
      const f=await fixture({show:near});
      const locked=await fixture({show:near,seat:ids.seat2});
      const failed=await fixture({show:near,confirmed:false});
      const lock=await pool.connect();
      try{
        await lock.query('BEGIN');
        await lock.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE',[locked.booking]);
        const waiting=pool.query("UPDATE bookings SET status='CANCELLED' WHERE id=$1",[locked.booking]).then(()=>null,e=>e);
        await rejects(()=>tx(async c=>{
          await c.query("UPDATE bookings SET status='CANCELLED' WHERE id=$1",[f.booking]);
          await c.query('SELECT pg_sleep(3.1)');
        }), '23514', /cancellation|cancel/i);
        await lock.query('ROLLBACK');
        const error=await waiting;
        assert.equal(error?.code,'23514');
        assert.match(error.message,/cancellation.*precede/i);
      }finally{await lock.query('ROLLBACK');lock.release();}
      assert.equal((await pool.query('SELECT status FROM bookings WHERE id=$1',[f.booking])).rows[0].status,'CONFIRMED');
      await rejects(()=>pool.query("UPDATE bookings SET status='CANCELLED' WHERE id=$1",[f.booking]),'23514',/cancellation|cancel/i);
      // A never-fulfilled capture is fully compensable beyond the cutoff.
      await tx(c=>refund(c,failed));
    });
  }finally{
    try{
      // Explicit fixture teardown only: this connection is a disposable _test
      // database administrator. No production guard accepts a cleanup flag.
      await tx(async c=>{
        await c.query("SET LOCAL session_replication_role='replica'");
        await c.query('DELETE FROM refund_attempts WHERE refund_id IN (SELECT id FROM refunds WHERE payment_id=ANY($1::uuid[]))',[payments]);
        await c.query('DELETE FROM refunds WHERE payment_id=ANY($1::uuid[])',[payments]);
        for(const table of ['payment_webhook_events','payment_reconciliations','payment_evidence'])await c.query(`DELETE FROM ${table} WHERE payment_id=ANY($1::uuid[])`,[payments]);
        await c.query('DELETE FROM payments WHERE id=ANY($1::uuid[])',[payments]);
        await c.query('DELETE FROM confirmed_seats WHERE booking_seat_id IN (SELECT id FROM booking_seats WHERE booking_id=ANY($1::uuid[]))',[bookings]);
        await c.query('DELETE FROM booking_seats WHERE booking_id=ANY($1::uuid[])',[bookings]);
        await c.query('DELETE FROM bookings WHERE id=ANY($1::uuid[])',[bookings]);
        await c.query('DELETE FROM show_seat_prices WHERE show_id=ANY($1::uuid[])',[shows]);
        await c.query('DELETE FROM shows WHERE id=ANY($1::uuid[])',[shows]);
        await c.query('DELETE FROM seats WHERE id=ANY($1::uuid[])',[[ids.seat,ids.seat2]]);
        await c.query('DELETE FROM screens WHERE id=$1',[ids.screen]);
        await c.query('DELETE FROM theatres WHERE id=$1',[ids.theatre]);
        await c.query('DELETE FROM cities WHERE id=$1',[ids.city]);
        await c.query('DELETE FROM movies WHERE id=$1',[ids.movie]);
        await c.query('DELETE FROM users WHERE id=$1',[ids.user]);
      });
    }finally{await pool.end();}
  }
});
