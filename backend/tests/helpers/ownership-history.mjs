import { randomUUID } from 'node:crypto';

// Isolated test fixture only; never imported by application or seed scripts.
export async function seedOwnershipHistory(db, userId) {
  const ids = Object.fromEntries(['city','theatre','screen','movie','show','seat','booking','bookingSeat','payment','refund','reconciliation'].map(k => [k, randomUUID()]));
  ids.user = userId;
  const providerPayment = `pay_${randomUUID()}`;
  await db.query('BEGIN');
  try {
    await db.query("INSERT INTO cities(id,name,state,updated_at) VALUES($1,$2,'Test',now())", [ids.city,ids.city]);
    await db.query("INSERT INTO theatres(id,name,address,city_id,updated_at) VALUES($1,'History theatre','Road',$2,now())", [ids.theatre,ids.city]);
    await db.query("INSERT INTO screens(id,name,capacity,theatre_id,updated_at) VALUES($1,'History screen',1,$2,now())", [ids.screen,ids.theatre]);
    await db.query("INSERT INTO movies(id,title,description,duration_minutes,release_date,language,genres,updated_at) VALUES($1,'History movie','Test',100,'2026-01-01','english',ARRAY['drama'],now())", [ids.movie]);
    await db.query("INSERT INTO seats(id,screen_id,row_name,seat_number,seat_type) VALUES($1,$2,'A',1,'REGULAR')", [ids.seat,ids.screen]);
    await db.query("INSERT INTO shows(id,movie_id,screen_id,starts_at,ends_at,updated_at) VALUES($1,$2,$3,'2099-01-01T10:00Z','2099-01-01T11:40Z',now())", [ids.show,ids.movie,ids.screen]);
    await db.query("INSERT INTO show_seat_prices(show_id,seat_type,price_paise) VALUES($1,'REGULAR',10000)", [ids.show]);
    await db.query("INSERT INTO bookings(id,user_id,show_id,total_paise,expires_at,updated_at) VALUES($1,$2,$3,10000,now()+interval '5 minutes',now())", [ids.booking,ids.user,ids.show]);
    await db.query('INSERT INTO booking_seats(id,booking_id,show_id,seat_id,price) VALUES($1,$2,$3,$4,10000)', [ids.bookingSeat,ids.booking,ids.show,ids.seat]);
    await db.query('INSERT INTO payments(id,booking_id,receipt,amount_paise,provider_order_id,updated_at) VALUES($1,$2,$3,10000,$4,now())', [ids.payment,ids.booking,randomUUID(),`order_${randomUUID()}`]);
    await db.query('INSERT INTO payment_evidence(provider_payment_id,payment_id,amount_paise,captured,updated_at) VALUES($1,$2,10000,true,now())', [providerPayment,ids.payment]);
    await db.query("UPDATE payments SET status='SUCCESS',provider_payment_id=$2,captured_at=clock_timestamp() WHERE id=$1", [ids.payment,providerPayment]);
    await db.query("UPDATE bookings SET status='FAILED' WHERE id=$1", [ids.booking]);
    await db.query('UPDATE payments SET booking_finalized_at=clock_timestamp() WHERE id=$1', [ids.payment]);
    await db.query("INSERT INTO payment_reconciliations(id,payment_id,reason,compensation_required,updated_at) VALUES($1,$2,'BOOKING_FAILED',true,now())", [ids.reconciliation,ids.payment]);
    await db.query("INSERT INTO refunds(id,payment_id,provider_payment_id,amount_paise,reason,updated_at) VALUES($1,$2,$3,10000,'BOOKING_FAILED',now())", [ids.refund,ids.payment,providerPayment]);
    await db.query("UPDATE payments SET status='REFUND_PENDING' WHERE id=$1", [ids.payment]);
    await db.query("INSERT INTO payment_webhook_events(provider_event_id,digest,event_type,payment_id,provider_payment_id,processed_at) VALUES($1,$2,'payment.captured',$3,$4,clock_timestamp())", [`evt_${ids.payment}`,'a'.repeat(64),ids.payment,providerPayment]);

    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}
