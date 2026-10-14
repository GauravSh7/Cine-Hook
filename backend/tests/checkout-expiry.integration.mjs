import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from 'redis';
import {createPrisma} from '../dist/lib/prisma.js';
import {createBooking} from '../dist/modules/booking/create-booking.js';
import {createEventBooking} from '../dist/modules/event-booking/create-event-booking.js';
import {PaymentRepository} from '../dist/modules/payments/payment.repository.js';
const url=process.env.PRICING_TEST_DATABASE_URL;
test('expired movie/event capture creates durable full compensation without fulfillment',{skip:!url},async()=>{
  const target=new URL(url);assert.match(target.pathname,/_test$/);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55438');
  const prisma=createPrisma(url),redis=createClient({url:'redis://127.0.0.1:55439/15'});await redis.connect();
  try{for(const kind of ['MOVIE','EVENT']){
    const user=await prisma.user.create({data:{name:'Expiry fixture',email:`${randomUUID()}@example.invalid`}}),id=randomUUID();
    let data,price,service;
    if(kind==='MOVIE'){
      const show=await prisma.show.findFirst({where:{startsAt:{gt:new Date()}},include:{prices:true}}),seat=await prisma.seat.findFirst({where:{screenId:show.screenId,seatType:show.prices[0].seatType}});price=show.prices[0].pricePaise;
      data={showId:show.id,seats:{create:{seatId:seat.id,price}}};service=createBooking(prisma,redis).bookings;
    }else{
      const session=await prisma.eventSession.findFirst({where:{startsAt:{gt:new Date()}},include:{prices:true}}),seat=await prisma.eventSeat.findFirst({where:{section:{venueId:session.venueId},ticketTier:session.prices[0].ticketTier}});price=session.prices[0].pricePaise;
      data={eventSessionId:session.id,eventSeats:{create:{eventSeatId:seat.id,price}}};service=createEventBooking(prisma,redis);
    }
    await prisma.booking.create({data:{...data,id,userId:user.id,bookingKind:kind,pricingVersion:0,totalPaise:BigInt(price),createdAt:new Date(Date.now()-300000),expiresAt:new Date(Date.now()-1000)}});
    const payment=await prisma.payment.create({data:{bookingId:id,amountPaise:BigInt(price),currency:'INR',receipt:randomUUID(),providerOrderId:`order_${randomUUID()}`}});
    await new PaymentRepository(prisma).recordEvidence(payment.id,{id:`pay_${randomUUID()}`,orderId:payment.providerOrderId,amountPaise:price,currency:'INR',status:'captured',captured:true});
    assert.equal((await service.getById(user.id,id)).status,'CANCELLED');
    assert.equal((await prisma.payment.findUnique({where:{id:payment.id}})).status,'REFUND_PENDING');
    assert.equal((await prisma.refund.findFirst({where:{paymentId:payment.id}})).amountPaise,BigInt(price));
  }}finally{await redis.quit();await prisma.$disconnect();}
});
