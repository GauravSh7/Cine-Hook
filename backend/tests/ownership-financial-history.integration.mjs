import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { createPrisma } from '../src/lib/prisma.ts';
import { OwnershipRepository } from '../src/modules/auth/ownership.repository.ts';
const url = process.env.OWNERSHIP_REPOSITORY_TEST_DATABASE_URL;
test('quarantine leaves bookings, seat history, captures, refunds and webhook audit evidence byte-for-byte unchanged', { skip: !url }, async () => {
  const target = new URL(url); assert.equal(target.host, '127.0.0.1:55448'); assert.equal(target.pathname, '/cinehook_ownership_migration_test');
  const db = new pg.Client({ connectionString: url }); await db.connect();
  const prisma = createPrisma(url), repo = new OwnershipRepository(prisma);
  const ids = Object.fromEntries(['user','city','theatre','screen','movie','show','seat','booking','bookingSeat','payment','refund','reconciliation'].map(k => [k, randomUUID()]));
  const email = `${randomUUID()}@example.test`, providerPayment = `pay_${randomUUID()}`;
  try {
    await db.query('BEGIN');
    await db.query("INSERT INTO users(id,name,email,password_hash,updated_at) VALUES($1,'Private owner',$2,'old-hash',now())", [ids.user,email]);
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
    async function history() {
      const records = {};
      for (const [table, predicate, id] of [ ['bookings','id',ids.booking], ['booking_seats','booking_id',ids.booking], ['payments','id',ids.payment], ['payment_evidence','payment_id',ids.payment], ['refunds','payment_id',ids.payment], ['payment_reconciliations','payment_id',ids.payment], ['payment_webhook_events','payment_id',ids.payment] ]) {
        records[table] = (await db.query(`SELECT to_jsonb(t) AS record FROM ${table} t WHERE ${predicate}=$1`, [id])).rows;
      }
      return records;
    }
    const before = await history();
    const replacement = await repo.cleanStart(await prisma.user.findUniqueOrThrow({ where: { id: ids.user } }), { name: 'Clean owner', passwordHash: 'new-hash' });
    assert.deepEqual(await history(), before);
    assert.equal(await prisma.booking.count({ where: { userId: replacement.id } }), 0);
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: ids.booking } })).userId, ids.user);
    await assert.rejects(prisma.user.delete({ where: { id: ids.user } }));
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { await db.end(); await prisma.$disconnect(); }
});
