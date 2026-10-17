import assert from 'node:assert/strict';
import { randomUUID, createHash, createHmac } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import request from 'supertest';
import { test } from 'node:test';
import pg from 'pg';
import { createClient } from 'redis';
import { createPrisma } from '../dist/lib/prisma.js';
import {legacyTicketPolicy} from './helpers/legacy-tax-fixture.mjs';

const url = process.env.EVENT_TEST_DATABASE_URL;
test('event booking native target, quotes, atomic fulfillment, cancellation and compensation', { skip: !url, timeout: 90000 }, async t => {
  const target = new URL(url);
  assert.equal(target.hostname,'127.0.0.1'); assert.equal(target.port,'55438'); assert.equal(target.username,'cinehook_verify');
  assert.match(target.pathname,/_test$/);
  const pool = new pg.Pool({ connectionString:url });
  const prisma = createPrisma(url);
  const transactionContext = new AsyncLocalStorage();
  const originalTransaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (work, options) => originalTransaction(tx => transactionContext.run(true, () => work(tx)), options);
  const redis = createClient({ url: 'redis://127.0.0.1:55439/15', disableOfflineQueue:true });
  redis.on('error',()=>{});
  try {
    const actual = (await pool.query('SELECT current_user,current_database(),inet_server_port() AS port')).rows[0];
    assert.equal(actual.current_user,'cinehook_verify'); assert.equal(actual.current_database,target.pathname.slice(1)); assert.equal(actual.port,55438);
    const columns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='bookings'")).rows.map(r=>r.column_name);
    assert.ok(columns.includes('booking_kind'), 'durable booking target discriminator is required');
    await redis.connect();
    const { createEventBooking } = await import('../dist/modules/event-booking/create-event-booking.js');
    const { createBooking } = await import('../dist/modules/booking/create-booking.js');
    const { BookingGateway } = await import('../dist/modules/booking/booking-gateway.js');
    const { BookingTargetRepository } = await import('../dist/modules/booking/booking-target.repository.js');
    const { PaymentRepository } = await import('../dist/modules/payments/payment.repository.js');
    const { PaymentService } = await import('../dist/modules/payments/payment.service.js');
    const { RefundRepository } = await import('../dist/modules/refunds/refund.repository.js');
    const { RefundService } = await import('../dist/modules/refunds/refund.service.js');
    const { EventBookingRepository } = await import('../dist/modules/event-booking/event-booking.repository.js');
    const { EventBookingService } = await import('../dist/modules/event-booking/event-booking.service.js');
    const { SeatLockService } = await import('../dist/modules/seat-lock/seat-lock.service.js');
    const { createUiRead } = await import('../dist/modules/ui-read/create-ui-read.js');
    const { createApp } = await import('../dist/app.js');
    const { createCatalog } = await import('../dist/modules/catalog/create-catalog.js');
    const { AuthService } = await import('../dist/modules/auth/auth.service.js');
    const { TokenService } = await import('../dist/modules/auth/token.service.js');
    const { UserRepository } = await import('../dist/modules/auth/user.repository.js');
    const { HealthService } = await import('../dist/modules/health/health.service.js');
    const { AppError } = await import('../dist/errors/app-error.js');
    const eventBookings = createEventBooking(prisma,redis);
    const gateway = new BookingGateway(new BookingTargetRepository(prisma),createBooking(prisma,redis).bookings,eventBookings);
    const owner=randomUUID(), other=randomUUID(), city=randomUUID(), event=randomUUID(), venue=randomUUID(), section=randomUUID();
    const seats=[randomUUID(),randomUUID()]; let sequence=0;
    await prisma.user.createMany({data:[owner,other].map(id=>({id,name:'Event native',email:`${id}@example.test`}))});
    await prisma.city.create({data:{id:city,name:randomUUID(),state:'Native'}});
    await prisma.event.create({data:{id:event,slug:randomUUID(),title:'Native comedy',description:'Fictional test',kind:'EVENTS',durationMinutes:60}});
    await legacyTicketPolicy(prisma,event,'event');
    await prisma.eventVenue.create({data:{id:venue,cityId:city,name:'Native venue',address:'Test',kind:'AUDITORIUM',capacity:2,
      sections:{create:{id:section,code:'FRONT',name:'Front',position:'FRONT',sortOrder:0,seats:{create:seats.map((id,i)=>({id,rowName:'A',seatNumber:i+1,ticketTier:i?'VIP':'STANDARD'}))}}}}});
    const session=async(start)=>{const id=randomUUID(); await prisma.eventSession.create({data:{id,eventId:event,venueId:venue,startsAt:start??new Date(Date.UTC(2099,0,++sequence)),prices:{create:[{ticketTier:'STANDARD',pricePaise:10000},{ticketTier:'VIP',pricePaise:15000}]}}}); return id;};
    const create=async(id,ids=seats,user=owner)=>eventBookings.create(user,{eventSessionId:id,seatIds:ids});
    const orders=new Map(), captures=new Map(), refunded=new Map();
    const key = (id,seat) => `cinehook:event-seat-lock:{${id}}:${seat}`;
    const nativePending = async(id, selected=seats, expiresAt=new Date(Date.now()+300000)) => prisma.booking.create({data:{id:randomUUID(),userId:owner,
      bookingKind:'EVENT',eventSessionId:id,totalPaise:BigInt(selected.reduce((sum,s)=>sum+(s===seats[0]?10000:15000),0)),expiresAt,
      eventSeats:{create:selected.map(s=>({eventSeatId:s,price:s===seats[0]?10000:15000}))}}});
    const signature = (order,payment) => createHmac('sha256','native-test-secret').update(`${order}|${payment}`).digest('hex');
    const provider={keyId:'native',findOrder:async receipt=>[...orders.values()].find(o=>o.receipt===receipt)??null,
      createOrder:async data=>{const value={...data,id:`order_${randomUUID()}`,status:'created'};orders.set(value.id,value);return value;},
      fetchOrder:async id=>orders.get(id), fetchPayment:async id=>captures.get(id), verifyCheckoutSignature:(order,payment,sig)=>sig===signature(order,payment),
      createRefund:async data=>{const value=refunded.get(data.idempotencyKey)??{id:`refund_${randomUUID()}`,paymentId:data.paymentId,amountPaise:data.amountPaise,currency:data.currency,receipt:data.receipt,status:'processed'};refunded.set(data.idempotencyKey,value);return value;},
      fetchRefund:async id=>[...refunded.values()].find(r=>r.id===id),parseWebhook:(raw,sig)=>{
        if(sig!==createHmac('sha256','native-webhook-secret').update(raw).digest('hex'))throw new AppError(400,'INVALID_WEBHOOK_SIGNATURE','Invalid webhook signature.');
        const data=JSON.parse(raw);return {eventType:data.eventType,payment:data.payment,digest:createHash('sha256').update(raw).digest('hex')};}};
    for(const method of ['findOrder','createOrder','fetchOrder','fetchPayment','createRefund','fetchRefund']){
      const call=provider[method];provider[method]=async(...args)=>{assert.notEqual(transactionContext.getStore(),true,`${method} must occur outside a database transaction`);return call(...args);};
    }
    const refunds=new RefundService(new RefundRepository(prisma),gateway,provider);
    const paymentStore = new PaymentRepository(prisma);
    const payments=new PaymentService(paymentStore,gateway,provider,refunds);
    const paymentInput=(booking,order,overrides={})=>{const id=`pay_${randomUUID()}`;captures.set(id,{id,orderId:order.id,amountPaise:order.amountPaise,currency:'INR',status:'captured',captured:true,...overrides});
      return {bookingId:booking.id,razorpay_order_id:order.id,razorpay_payment_id:id,razorpay_signature:signature(order.id,id)};};
    const capture=async(booking,order)=>{const input=paymentInput(booking,order);await payments.verify(owner,input);return input;};
    const webhook=async(input,eventId=randomUUID())=>{const raw=Buffer.from(JSON.stringify({eventType:'payment.captured',payment:captures.get(input.razorpay_payment_id)}));
      await payments.webhook(raw,createHmac('sha256','native-webhook-secret').update(raw).digest('hex'),eventId);return eventId;};
    const tokens=new TokenService({secret:'event-native-auth-only-12345678901234567890',expiresInSeconds:3600});
    const auth={tokens,service:new AuthService(new UserRepository(prisma),tokens)};
    const app=createApp({frontendOrigin:'http://localhost:5173',auth,catalog:createCatalog(prisma),booking:{bookings:gateway},eventBooking:eventBookings,
      payments:{payments,refunds},uiRead:createUiRead(prisma,gateway),healthService:new HealthService({checkDatabase:async()=>{},checkRedis:async()=>{}})});
    const token=tokens.sign({userId:owner,role:'USER'}),otherToken=tokens.sign({userId:other,role:'USER'});
    const get=async(path,bearer=token)=>request(app).get(path).set('Authorization',`Bearer ${bearer}`);
    const rejects=(work,code)=>assert.rejects(work,e=>{assert.equal(e.code,code,e.message);return true;});
    const sqlRejects=(work,code='23514')=>assert.rejects(work,e=>{
      const state=e.meta?.driverAdapterError?.cause?.originalCode??e.cause?.originalCode??e.code;
      assert.equal(state,code,e.message);return true;
    });
    await t.test('foreign seats, duplicate seats and ownership rejected; server snapshots and fixed TTL',async()=>{
      const id=await session();
      await rejects(()=>create(id,[randomUUID()]),'INVALID_SEATS'); await rejects(()=>create(id,[seats[0],seats[0]]),'INVALID_SEATS');
      const before=Date.now(), booking=await create(id); assert.equal(booking.totalPaise,25000);assert.equal(booking.bookingKind,'EVENT');assert.equal(booking.eventSessionId,id);
      assert.ok(booking.expiresAt.getTime()-before<=301000);assert.ok(booking.expiresAt.getTime()-before>=295000);
      assert.equal(booking.expiresAt.getTime(),await redis.sendCommand(['PEXPIRETIME',key(id,seats[0])]));
      await rejects(()=>gateway.getById(other,booking.id),'NOT_FOUND');await rejects(()=>gateway.payable(other,booking.id),'NOT_FOUND');
      await prisma.eventSessionPrice.update({where:{sessionId_ticketTier:{sessionId:id,ticketTier:'STANDARD'}},data:{pricePaise:11000}});
      assert.equal((await gateway.getById(owner,booking.id)).totalPaise,25000);
    });
    await t.test('two owners compete atomically and failed multi-seat holds leave free seats untouched',async()=>{
      const id=await session();const race=await Promise.allSettled([create(id,[seats[0]],owner),create(id,[seats[0]],other)]);
      assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
      await rejects(()=>create(id,seats),'SEAT_LOCKED');assert.equal(await redis.exists(`cinehook:event-seat-lock:{${id}}:${seats[1]}`),0);
    });
    await t.test('capture finalizes event in shared transaction, replay does not revive cancellation and rebooking succeeds',async()=>{
      const id=await session(), booking=await create(id), order=(await payments.order(owner,booking.id)).order;
      const input=await capture(booking,order);assert.equal((await gateway.getById(owner,booking.id)).status,'CONFIRMED');
      assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),2);
      assert.equal(await redis.exists(seats.map(s=>`cinehook:event-seat-lock:{${id}}:${s}`)),0);
      await Promise.all([refunds.cancel(owner,booking.id),refunds.cancel(owner,booking.id)]);
      await payments.verify(owner,input);assert.equal((await gateway.getById(owner,booking.id)).status,'CANCELLED');
      assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),0);
      assert.equal((await refunds.get(owner,booking.id)).payment.status,'REFUNDED');
      assert.equal((await prisma.eventBookingSeat.findMany({where:{bookingId:booking.id}})).length,2);
      const replacement=await create(id);assert.equal(replacement.status,'PENDING');
      assert.deepEqual((await eventBookings.availability(id)).seats.map(s=>s.availability),['LOCKED','LOCKED']);
    });
    await t.test('expired Redis hold leads to durable full compensation with capture truth preserved',async()=>{
      const id=await session(), booking=await create(id), order=(await payments.order(owner,booking.id)).order;
      for(const s of seats) await redis.pExpire(`cinehook:event-seat-lock:{${id}}:${s}`,1);
      await new Promise(r=>setTimeout(r,10));await capture(booking,order);
      const view=await refunds.get(owner,booking.id);assert.equal(view.booking.status,'FAILED');assert.equal(view.payment.status,'REFUNDED');
      assert.equal(view.refunds[0].amountPaise,order.amountPaise);assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),0);
    });
    await t.test('native target XOR, quote mismatch and immutable target are rejected',async()=>{
      const id=await session();
      await sqlRejects(()=>pool.query("INSERT INTO bookings(id,user_id,booking_kind,total_paise,expires_at,updated_at) VALUES($1,$2,'EVENT',25000,now()+interval '5 minutes',now())",[randomUUID(),owner]));
      const booking=await create(id);
      const differentSession = await session();
      await sqlRejects(()=>pool.query('UPDATE bookings SET event_session_id=$2 WHERE id=$1',[booking.id,differentSession]));
      await sqlRejects(()=>pool.query('UPDATE event_booking_seats SET price=1 WHERE booking_id=$1',[booking.id]));
      assert.equal((await prisma.booking.findUnique({where:{id:booking.id}})).eventSessionId,id);
    });
    await t.test('HTTP holds reject financial/kind flags and expose owner-scoped unified detail/history/summary',async()=>{
      const id=await session();
      const post=(body,bearer=token)=>request(app).post('/api/event-bookings').set('Authorization',`Bearer ${bearer}`).send(body);
      for(const extra of [{paid:true},{bookingKind:'MOVIE'},{totalPaise:1},{showId:randomUUID()},{confirmed:true},{refundSuccess:true}]){
        assert.equal((await post({eventSessionId:id,seatIds:seats,...extra})).status,400);
      }
      assert.equal((await request(app).post('/api/event-bookings').send({eventSessionId:id,seatIds:seats})).status,401);
      const response=await post({eventSessionId:id,seatIds:seats});assert.equal(response.status,201,JSON.stringify(response.body));
      const booking=response.body.data.booking;assert.equal(response.headers['cache-control'],'no-store');
      assert.equal((await get(`/api/bookings/${booking.id}`,otherToken)).status,404);
      const summary=await get(`/api/bookings/${booking.id}/summary`);assert.equal(summary.status,200,JSON.stringify(summary.body));
      assert.equal(summary.body.data.show,null);assert.equal(summary.body.data.eventSession.event.title,'Native comedy');
      assert.equal(summary.body.data.booking.seats[0].sectionCode,'FRONT');
      assert.equal((await get(`/api/bookings/${booking.id}/summary`,otherToken)).status,404);
      assert.ok((await get('/api/bookings?limit=100')).body.data.items.some(b=>b.id===booking.id&&b.bookingKind==='EVENT'));
      const availability=await get(`/api/event-sessions/${id}/availability`);assert.equal(availability.status,200);
      assert.equal(availability.headers['cache-control'],'no-store');assert.ok(availability.body.data.seats.every(s=>s.availability==='LOCKED'));
      assert.doesNotMatch(JSON.stringify(availability.body),/holdId|userId|owner/);
      for(const path of [`/api/bookings/${booking.id}/confirm`,`/api/event-bookings/${booking.id}/confirm`,`/api/refunds/${booking.id}/success`]){
        assert.equal((await request(app).post(path).set('Authorization',`Bearer ${token}`).send({paid:true})).status,404);
      }
      await prisma.user.update({where:{id:owner},data:{role:'ADMIN'}});
      const admin=await get('/api/admin/bookings?limit=100');assert.equal(admin.status,200);
      assert.ok(admin.body.data.items.some(b=>b.id===booking.id&&b.eventSession.id===id&&b.show===null));
      await prisma.user.update({where:{id:owner},data:{role:'USER'}});
      assert.equal((await get('/api/admin/bookings')).status,403);
      assert.equal((await request(app).delete(`/api/bookings/${booking.id}/hold`).set('Authorization',`Bearer ${otherToken}`)).status,404);
      assert.equal((await request(app).delete(`/api/bookings/${booking.id}/hold`).set('Authorization',`Bearer ${token}`)).status,200);
      assert.equal(await redis.exists(seats.map(s=>key(id,s))),0);
    });
    await t.test('persisted expired hold compensates late capture without reacquiring seats',async()=>{
      const id=await session(), booking=await nativePending(id,seats,new Date(Date.now()-1000));
      const reserved=await prisma.payment.create({data:{id:randomUUID(),bookingId:booking.id,receipt:randomUUID(),amountPaise:25000n}});
      const order=await provider.createOrder({receipt:reserved.receipt,amountPaise:25000,currency:'INR'});await paymentStore.attachOrder(reserved.id,order);
      await capture(booking,order);const view=await refunds.get(owner,booking.id);
      assert.equal(view.booking.status,'FAILED');assert.equal(view.payment.status,'REFUNDED');assert.equal(view.refunds[0].amountPaise,25000);
      assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),0);assert.equal(await redis.exists(seats.map(s=>key(id,s))),0);
    });
    await t.test('allocation collision compensates the loser and rolls back every unoccupied selected seat',async()=>{
      const id=await session(), booking=await create(id),order=(await payments.order(owner,booking.id)).order;
      const winner=await nativePending(id,[seats[0]]);await prisma.booking.update({where:{id:winner.id},data:{status:'CONFIRMED'}});
      await capture(booking,order);const view=await refunds.get(owner,booking.id);
      assert.equal(view.booking.status,'FAILED');assert.equal(view.payment.status,'REFUNDED');
      assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),1);
      assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id,seatId:seats[1]}}),0);
    });
    await t.test('browser-close webhook and concurrent verification replay allocate once with globally bound evidence',async()=>{
      const id=await session(), booking=await create(id),order=(await payments.order(owner,booking.id)).order,input=paymentInput(booking,order);
      const eventId=randomUUID();await Promise.all([webhook(input,eventId),webhook(input,eventId),payments.verify(owner,input)]);
      const payment=await paymentStore.findByBooking(booking.id);assert.equal(payment.status,'SUCCESS');assert.ok(payment.bookingFinalizedAt);
      assert.equal(await prisma.paymentEvidence.count({where:{paymentId:payment.id,captured:true}}),1);
      assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),2);
      assert.ok((await prisma.paymentWebhookEvent.findUnique({where:{providerEventId:eventId}})).processedAt);
      const nextId=await session(),next=await create(nextId),nextOrder=(await payments.order(owner,next.id)).order,nextInput=paymentInput(next,nextOrder);
      await rejects(()=>webhook(nextInput,eventId),'PAYMENT_CONFLICT');
      assert.equal((await paymentStore.findByBooking(next.id)).status,'PENDING');
    });
    await t.test('bad signatures, mismatched amounts and unauthorized captures cannot allocate event seats',async()=>{
      const id=await session(),booking=await create(id),order=(await payments.order(owner,booking.id)).order;
      await rejects(()=>payments.order(other,booking.id),'NOT_FOUND');
      const input=paymentInput(booking,order);await rejects(()=>payments.verify(other,input),'NOT_FOUND');
      await rejects(()=>payments.verify(owner,{...input,razorpay_signature:'0'.repeat(64)}),'INVALID_PAYMENT_SIGNATURE');
      const wrong=paymentInput(booking,order,{amountPaise:1});await rejects(()=>payments.verify(owner,wrong),'PAYMENT_MISMATCH');
      const authOnly=paymentInput(booking,order,{status:'authorized',captured:false});await payments.verify(owner,authOnly);
      assert.equal((await paymentStore.findByBooking(booking.id)).status,'PENDING');assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),0);
    });
    await t.test('transaction rollback leaves paid evidence retryable and Redis cleanup waits for commit',async()=>{
      const id=await session(),booking=await create(id),order=(await payments.order(owner,booking.id)).order,input=paymentInput(booking,order);
      const faultStore={reserve:paymentStore.reserve.bind(paymentStore),attachOrder:paymentStore.attachOrder.bind(paymentStore),findByBooking:paymentStore.findByBooking.bind(paymentStore),
        findByOrder:paymentStore.findByOrder.bind(paymentStore),findByReceipt:paymentStore.findByReceipt.bind(paymentStore),recordEvidence:paymentStore.recordEvidence.bind(paymentStore),
        markEventProcessed:paymentStore.markEventProcessed.bind(paymentStore),finalize:(pid,work)=>paymentStore.finalize(pid,async scope=>{await work(scope);
          assert.equal(await redis.exists(seats.map(s=>key(id,s))),2);throw new AppError(409,'CONCURRENT_CHANGE','Injected rollback');})};
      const fault=new PaymentService(faultStore,gateway,provider,refunds);await rejects(()=>fault.verify(owner,input),'CONCURRENT_CHANGE');
      assert.equal((await paymentStore.findByBooking(booking.id)).status,'SUCCESS');assert.equal((await paymentStore.findByBooking(booking.id)).bookingFinalizedAt,null);
      assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),0);assert.equal(await redis.exists(seats.map(s=>key(id,s))),2);
      await payments.verify(owner,input);assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),2);
    });
    await t.test('strict cancellation cutoff keeps confirmed tickets; paid unfulfilled capture compensates after event start',async()=>{
      const starts=new Date(Date.now()+4000),id=await session(starts),booking=await create(id,[seats[0]]),order=(await payments.order(owner,booking.id)).order;
      const late=await create(id,[seats[1]]),lateOrder=(await payments.order(owner,late.id)).order;
      await gateway.releaseHold(owner,late.id);await capture(booking,order);
      const delayedGateway={cancel:async(user,bid,scope)=>{const result=await gateway.cancel(user,bid,scope);
        await new Promise(r=>setTimeout(r,Math.max(0,starts.getTime()-Date.now()+30)));return result;}};
      const delayedRefunds=new RefundService(new RefundRepository(prisma),delayedGateway,provider);
      await rejects(()=>delayedRefunds.cancel(owner,booking.id),'CANCELLATION_CLOSED');
      assert.equal(await prisma.refund.count({where:{paymentId:(await paymentStore.findByBooking(booking.id)).id}}),0);
      await rejects(()=>refunds.cancel(owner,booking.id),'CANCELLATION_CLOSED');
      assert.equal((await gateway.getById(owner,booking.id)).status,'CONFIRMED');assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),1);
      await capture(late,lateOrder);const view=await refunds.get(owner,late.id);assert.equal(view.booking.status,'CANCELLED');assert.equal(view.payment.status,'REFUNDED');
      assert.equal(view.refunds[0].amountPaise,lateOrder.amountPaise);assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id,seatId:seats[1]}}),0);
    });
    await t.test('event cancellation and rebooking during Redis inspection are seen as held, then durable allocations win last',async()=>{
      const id=await session(),booking=await create(id),order=(await payments.order(owner,booking.id)).order;await capture(booking,order);
      const store=new EventBookingRepository(prisma),locks=new SeatLockService(redis,'event');let replacement;
      const inspect={acquire:locks.acquire.bind(locks),validate:locks.validate.bind(locks),release:locks.release.bind(locks),inspect:async(sessionId,ids)=>{
        assert.deepEqual(new Set(ids),new Set(seats));await refunds.cancel(owner,booking.id);replacement=await create(id);return locks.inspect(sessionId,ids);}};
      const racing=new EventBookingService(store,inspect);assert.ok((await racing.availability(id)).seats.every(s=>s.availability==='LOCKED'));
      const replacementOrder=(await payments.order(owner,replacement.id)).order;
      const inspectCommit={...inspect,inspect:async(sessionId,ids)=>{const before=await locks.inspect(sessionId,ids);await capture(replacement,replacementOrder);return before;}};
      assert.ok((await new EventBookingService(store,inspectCommit).availability(id)).seats.every(s=>s.availability==='BOOKED'));
    });
    await t.test('capture racing unpaid release yields one durable outcome and full compensation for unfulfilled capture',async()=>{
      for(let iteration=0;iteration<4;iteration++){
        const id=await session(),booking=await create(id),order=(await payments.order(owner,booking.id)).order,input=paymentInput(booking,order);
        await Promise.allSettled([payments.verify(owner,input),gateway.releaseHold(owner,booking.id)]);
        await payments.verify(owner,input);const view=await refunds.get(owner,booking.id);
        assert.ok(['CONFIRMED','CANCELLED'].includes(view.booking.status));
        assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),view.booking.status==='CONFIRMED'?2:0);
        assert.equal(view.payment.status,view.booking.status==='CONFIRMED'?'SUCCESS':'REFUNDED');
      }
    });
    await t.test('native foreign venue, mixed targets, forged prices and wrong allocation identities roll back',async()=>{
      const foreignVenue=randomUUID(),foreignSeat=randomUUID();await prisma.eventVenue.create({data:{id:foreignVenue,cityId:city,name:randomUUID(),address:'Test',kind:'ARENA',capacity:1,
        sections:{create:{code:'EAST',name:'East',position:'EAST',sortOrder:0,seats:{create:{id:foreignSeat,rowName:'Z',seatNumber:1,ticketTier:'STANDARD'}}}}}});
      const id=await session();await rejects(()=>create(id,[foreignSeat]),'INVALID_SEATS');
      const bad=async(selected,prices,total=25000n)=>prisma.booking.create({data:{id:randomUUID(),userId:owner,bookingKind:'EVENT',eventSessionId:id,totalPaise:total,
        expiresAt:new Date(Date.now()+300000),eventSeats:{create:selected.map((s,i)=>({eventSeatId:s,price:prices[i]}))}}});
      await sqlRejects(()=>bad([foreignSeat],[10000],10000n));await sqlRejects(()=>bad(seats,[1,24999]));await sqlRejects(()=>bad(seats,[10000,15000],1n));
      await sqlRejects(()=>pool.query("INSERT INTO bookings(id,user_id,booking_kind,show_id,event_session_id,total_paise,expires_at,updated_at) VALUES($1,$2,'EVENT',$3,$4,25000,now()+interval '5 minutes',now())",[randomUUID(),owner,randomUUID(),id]));
      const booking=await create(id);const quote=await prisma.eventBookingSeat.findFirst({where:{bookingId:booking.id}});
      await sqlRejects(()=>prisma.eventConfirmedSeat.create({data:{sessionId:id,seatId:foreignSeat,bookingSeatId:quote.id}}));
      await sqlRejects(()=>pool.query('DELETE FROM event_booking_seats WHERE booking_id=$1',[booking.id]));
      assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),0);
    });
    await t.test('Redis outage preserves captured truth and unfinished webhook; replay fulfills after recovery',async()=>{
      const id=await session(),booking=await create(id),order=(await payments.order(owner,booking.id)).order,input=paymentInput(booking,order),eventId=randomUUID();
      redis.destroy();await rejects(()=>webhook(input,eventId),'SEAT_LOCK_UNAVAILABLE');
      const payment=await paymentStore.findByBooking(booking.id);assert.equal(payment.status,'SUCCESS');assert.equal(payment.bookingFinalizedAt,null);
      assert.equal((await prisma.paymentWebhookEvent.findUnique({where:{providerEventId:eventId}})).processedAt,null);
      await redis.connect();await webhook(input,eventId);assert.equal((await gateway.getById(owner,booking.id)).status,'CONFIRMED');
      assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),2);
    });
    await t.test('duplicate capture creates only extra-source full refund and concurrent retries retain one durable attempt',async()=>{
      const id=await session(),booking=await create(id),order=(await payments.order(owner,booking.id)).order;await capture(booking,order);
      const extra=paymentInput(booking,order);const originalRefund=provider.createRefund;let first=true;
      provider.createRefund=async data=>{assert.notEqual(transactionContext.getStore(),true);if(first){first=false;throw new Error('Injected uncertain refund transport');}return originalRefund(data);};
      await payments.verify(owner,extra);let view=await refunds.get(owner,booking.id);
      assert.equal(view.booking.status,'CONFIRMED');assert.equal(view.payment.status,'SUCCESS');assert.equal(view.refunds.length,1);
      assert.equal(view.refunds[0].providerPaymentId,extra.razorpay_payment_id);assert.equal(view.refunds[0].amountPaise,order.amountPaise);
      assert.equal(view.refunds[0].attempts.length,1);const attemptId=view.refunds[0].attempts[0].id;
      await Promise.all([refunds.retry(owner,booking.id),refunds.retry(owner,booking.id)]);
      view=await refunds.get(owner,booking.id);assert.equal(view.refunds[0].status,'REFUNDED');assert.equal(view.refunds[0].attempts.length,1);
      assert.equal(view.refunds[0].attempts[0].id,attemptId);assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),2);
      provider.createRefund=originalRefund;
    });
    await t.test('session cancellation and inactive event prevent holds/finalization while captured payment still compensates',async()=>{
      const id=await session(),booking=await create(id),order=(await payments.order(owner,booking.id)).order;
      await prisma.eventSession.update({where:{id},data:{status:'CANCELLED'}});
      await rejects(()=>create(id),'EVENT_SESSION_NOT_FOUND');await capture(booking,order);
      assert.equal((await refunds.get(owner,booking.id)).payment.status,'REFUNDED');assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),0);
      const inactive=await session(),pending=await create(inactive),pendingOrder=(await payments.order(owner,pending.id)).order;
      await prisma.event.update({where:{id:event},data:{isActive:false}});
      await rejects(()=>create(inactive),'EVENT_SESSION_NOT_FOUND');await capture(pending,pendingOrder);
      assert.equal((await refunds.get(owner,pending.id)).booking.status,'FAILED');assert.equal((await refunds.get(owner,pending.id)).payment.status,'REFUNDED');
      await prisma.event.update({where:{id:event},data:{isActive:true}});
    });
    await t.test('lost old hold cannot delete replacement owner-fenced grant on late capture',async()=>{
      const id=await session(),old=await create(id),order=(await payments.order(owner,old.id)).order;
      for(const s of seats)await redis.pExpire(key(id,s),0);
      const replacement=await create(id);const expiry=replacement.expiresAt.getTime();
      await capture(old,order);assert.equal((await refunds.get(owner,old.id)).payment.status,'REFUNDED');
      assert.equal(await redis.sendCommand(['PEXPIRETIME',key(id,seats[0])]),expiry);
      assert.equal(await redis.get(key(id,seats[0])),`${owner}:${replacement.id}`);
      await gateway.getById(owner,replacement.id);assert.equal(await redis.sendCommand(['PEXPIRETIME',key(id,seats[0])]),expiry);
    });
    await t.test('quote is refreshed under native parent locks after a price changes during Redis acquisition',async()=>{
      const id=await session(),store=new EventBookingRepository(prisma),locks=new SeatLockService(redis,'event');
      const changingLocks={validate:locks.validate.bind(locks),release:locks.release.bind(locks),inspect:locks.inspect.bind(locks),acquire:async(...args)=>{
        const grant=await locks.acquire(...args);await prisma.eventSessionPrice.update({where:{sessionId_ticketTier:{sessionId:id,ticketTier:'STANDARD'}},data:{pricePaise:12000}});return grant;}};
      const service=new EventBookingService(store,changingLocks),booking=await service.create(owner,{eventSessionId:id,seatIds:seats});
      assert.equal(booking.totalPaise,27000);assert.deepEqual(booking.seats.map(s=>s.pricePaise).sort((a,b)=>a-b),[12000,15000]);
      await prisma.eventSessionPrice.update({where:{sessionId_ticketTier:{sessionId:id,ticketTier:'STANDARD'}},data:{pricePaise:17000}});
      assert.equal((await gateway.getById(owner,booking.id)).totalPaise,27000);
    });
    await t.test('trusted gateway routes movie creation and financial fulfillment through original movie guards while merging event history',async()=>{
      const theatre=randomUUID(),screen=randomUUID(),movie=randomUUID(),show=randomUUID(),movieSeat=randomUUID();
      await prisma.theatre.create({data:{id:theatre,cityId:city,name:randomUUID(),address:'Test'}});
      await legacyTicketPolicy(prisma,theatre);
      await prisma.screen.create({data:{id:screen,theatreId:theatre,name:'Movie screen',capacity:1,seats:{create:{id:movieSeat,rowName:'A',seatNumber:1,seatType:'REGULAR'}}}});
      await prisma.movie.create({data:{id:movie,title:'Native movie',description:'Test',durationMinutes:60,releaseDate:new Date('2026-01-01'),language:'english',genres:['drama']}});
      await prisma.show.create({data:{id:show,movieId:movie,screenId:screen,startsAt:new Date('2098-01-01'),endsAt:new Date('2098-01-01T01:00:00Z'),prices:{create:{seatType:'REGULAR',pricePaise:9000}}}});
      const booking=await gateway.create(owner,{showId:show,seatIds:[movieSeat]});assert.equal(booking.bookingKind,'MOVIE');assert.equal(booking.eventSessionId,null);
      const order=(await payments.order(owner,booking.id)).order;await capture(booking,order);
      assert.equal((await gateway.getById(owner,booking.id)).status,'CONFIRMED');assert.equal(await prisma.confirmedSeat.count({where:{showId:show}}),1);
      const history=await gateway.list(owner,{page:1,limit:100});assert.ok(history.items.some(b=>b.bookingKind==='MOVIE'));assert.ok(history.items.some(b=>b.bookingKind==='EVENT'));
      const summary=await get(`/api/bookings/${booking.id}/summary`);assert.equal(summary.status,200);assert.equal(summary.body.data.show.movie.title,'Native movie');
      await refunds.cancel(owner,booking.id);assert.equal(await prisma.confirmedSeat.count({where:{showId:show}}),0);
    });
    await t.test('expiry at fulfillment commit rolls back allocation and immediately creates full compensation',async()=>{
      const id=await session(),expiry=new Date(Date.now()+2000),booking=await nativePending(id,seats,expiry);
      const locks=new SeatLockService(redis,'event');await locks.acquire(id,seats,owner,booking.id);
      const order=(await payments.order(owner,booking.id)).order,input=paymentInput(booking,order);
      const slowStore={reserve:paymentStore.reserve.bind(paymentStore),attachOrder:paymentStore.attachOrder.bind(paymentStore),findByBooking:paymentStore.findByBooking.bind(paymentStore),
        findByOrder:paymentStore.findByOrder.bind(paymentStore),findByReceipt:paymentStore.findByReceipt.bind(paymentStore),recordEvidence:paymentStore.recordEvidence.bind(paymentStore),
        markEventProcessed:paymentStore.markEventProcessed.bind(paymentStore),finalize:(pid,work)=>paymentStore.finalize(pid,async scope=>{const result=await work(scope);
          await new Promise(r=>setTimeout(r,Math.max(0,expiry.getTime()-Date.now()+30)));return result;})};
      await new PaymentService(slowStore,gateway,provider,refunds).verify(owner,input);
      const view=await refunds.get(owner,booking.id);assert.equal(view.booking.status,'FAILED');assert.equal(view.payment.status,'REFUNDED');
      assert.equal(view.refunds[0].amountPaise,25000);assert.equal(await prisma.eventConfirmedSeat.count({where:{sessionId:id}}),0);
      assert.equal(await redis.exists(seats.map(s=>key(id,s))),0);
    });
  } finally { if(redis.isOpen)redis.destroy();await prisma.$disconnect();await pool.end(); }
});
