import { Prisma, type PrismaClient, type Booking } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { calculateQuote, type TaxPolicy, type PricingContext } from './pricing-engine.js';
import {parseConfig} from '../../config/env.js';

const stateError = () => new AppError(409,'BOOKING_STATE','This booking cannot be priced.');
const firstError = () => new AppError(409,'FIRST_OFFER_UNAVAILABLE','The first-booking offer is unavailable or reserved for another checkout.');
export class PricingRepository {
  private readonly testKeyId?:string;
  private readonly testTarget?:{database:string;role:string;port:number};
  constructor(private readonly prisma: PrismaClient, private readonly context: PricingContext = 'verified', testEnvironment?:Record<string,string|undefined>) {
    if(context==='razorpay-test'){
      const config=parseConfig(testEnvironment??{});
      if((!config.devRazorpayTestCheckout&&!config.stagingRazorpayTestCheckout)||!config.razorpay)throw new AppError(503,'TEST_CHECKOUT_DISABLED','TEST checkout is not enabled.');
      this.testKeyId=config.razorpay.keyId;
      const target=new URL(config.databaseUrl);
      this.testTarget=config.stagingRazorpayTestCheckout
        ? {database:decodeURIComponent(target.pathname.slice(1)),role:decodeURIComponent(target.username),port:Number(target.port||5432)}
        : {database:'cinehook_dev',role:decodeURIComponent(target.username),port:5432};
    }
  }
  assertProvider(keyId:string){if(this.context==='razorpay-test'&&keyId!==this.testKeyId)throw new AppError(503,'TEST_CHECKOUT_DISABLED','TEST provider configuration does not match.');}
  private async allowSimulation(tx: Prisma.TransactionClient) {
    if (this.context === 'verified') return false;
    const [identity] = await tx.$queryRaw<Array<{name:string;role:string;schema:string;port:number}>>`SELECT current_database() AS name, current_user AS role, current_schema() AS schema, inet_server_port() AS port`;
    if(this.context==='development-preview')return identity?.name==='cinehook_dev'&&identity.schema==='public'&&identity.port===5432;
    if(this.context==='razorpay-test')return !!identity&&!!this.testTarget&&identity.name===this.testTarget.database
      && identity.role===this.testTarget.role&&identity.schema==='public'&&identity.port===this.testTarget.port;
    return !!identity&&identity.port===55438&&/^(?:cinehook_event_seed_pricing|refinement_ui_native)_[a-z0-9_]+_test$/.test(identity.name);
  }
  async assertPaymentAllowed(tx: Prisma.TransactionClient, breakdown: Prisma.JsonValue | undefined) {
    const quote = breakdown as unknown as {simulated?:boolean;policy?:TaxPolicy} | undefined;
    if ((quote?.simulated || quote?.policy?.simulation) && (!['controlled-test','razorpay-test'].includes(this.context) || !await this.allowSimulation(tx))) {
      throw new AppError(409,'SIMULATED_PREVIEW_ONLY','Simulated bills cannot initiate provider payments.');
    }
  }
  async clock(tx: Prisma.TransactionClient) {
    const [r] = await tx.$queryRaw<{ms:bigint}[]>`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS ms`;
    return new Date(Number(r!.ms));
  }
  private async userLock(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`);
  }
  private async reservation(tx: Prisma.TransactionClient, b: Booking, code: string | null, now: Date) {
    await this.userLock(tx,b.userId);
    let offer = await tx.firstBookingOffer.findUnique({where:{userId:b.userId}});
    if (offer?.reservedBookingId && offer.reservedBookingId!==b.id && !offer.consumedAt) {
      const other = await tx.booking.findUnique({where:{id:offer.reservedBookingId},include:{payment:true}});
      // An issued/uncertain provider order may still capture. Never release it on timeout or failure alone.
      if (other && !other.payment && (other.status!=='PENDING' || other.expiresAt<=now)) {
        offer = await tx.firstBookingOffer.update({where:{userId:b.userId},data:{reservedBookingId:null}});
      }
    }
    if (code!=='FIRST50') {
      if (offer?.reservedBookingId===b.id && !offer.consumedAt) await tx.firstBookingOffer.update({where:{userId:b.userId},data:{reservedBookingId:null}});
      return;
    }
    const captures = await tx.paymentEvidence.count({where:{captured:true,payment:{booking:{userId:b.userId}}}});
    // Old orders also block a first-offer reservation until their outcome is known.
    const uncertain = await tx.payment.count({where:{booking:{userId:b.userId,id:{not:b.id}},evidence:{none:{captured:true}}}});
    if (captures || uncertain || offer?.consumedAt || (offer?.reservedBookingId && offer.reservedBookingId!==b.id)) throw firstError();
    await tx.firstBookingOffer.upsert({where:{userId:b.userId},create:{userId:b.userId,reservedBookingId:b.id},update:{reservedBookingId:b.id}});
  }
  async price(tx: Prisma.TransactionClient, b: Booking, code: string | null) {
    const now = await this.clock(tx);
    if (b.status!=='PENDING' || b.expiresAt<=now) throw stateError();
    const old = await tx.bookingPricingQuote.findUnique({where:{bookingId:b.id}});
    if (old?.frozenAt) {
      if (old.couponCode!==code) throw new AppError(409,'QUOTE_FROZEN','The coupon cannot change after payment starts.');
      return old;
    }
    if (b.pricingVersion!==1) throw new AppError(409,'LEGACY_QUOTE','Existing bookings keep their original prices and cannot use new coupons.');
    await this.reservation(tx,b,code,now);
    const movie = b.showId ? await tx.show.findUnique({where:{id:b.showId},select:{screen:{select:{theatreId:true}}}}) : null;
    const event = b.eventSessionId ? await tx.eventSession.findUnique({where:{id:b.eventSessionId},select:{eventId:true,event:{select:{kind:true}}}}) : null;
    const prefix = movie ? `movie:${movie.screen.theatreId}:` : event ? `event:${event.eventId}:` : '';
    const configurations = prefix ? await tx.pricingTaxPolicy.findMany({where:{key:{startsWith:prefix}}}) : [];
    const allowSimulation = await this.allowSimulation(tx);
    const current = configurations.filter(c=>{
      const p = c.settings as unknown as TaxPolicy;
      const targetMatches=movie?p.classification==='CINEMA'&&p.simulation?.bracketRule==='ORIGINAL_INCLUSIVE_TICKET'
        :!!event&&['EVENTS','SPORTS','ACTIVITIES'].includes(event.event.kind)&&p.classification==='ADMISSION_18'&&p.simulation?.bracketRule==='FLAT_ADMISSION_18';
      return c.verifiedBy && (p.simulation ? allowSimulation && targetMatches : p.verified===true) && Date.parse(p.effectiveFrom)<=now.getTime() && (!p.effectiveTo || now.getTime()<Date.parse(p.effectiveTo));
    });
    if (current.length!==1) throw new AppError(409,'TAX_CONFIGURATION_REQUIRED','Checkout is unavailable until tax settings are verified.');
    const tickets = b.showId ? (await tx.bookingSeat.findMany({where:{bookingId:b.id},select:{id:true,price:true}}))
      : await tx.eventBookingSeat.findMany({where:{bookingId:b.id},select:{id:true,price:true}});
    const breakdown = calculateQuote(tickets,code,current[0]!.settings as unknown as TaxPolicy,now,this.context,b.createdAt);
    if (BigInt(breakdown.subtotalPaise)!==b.totalPaise) throw stateError();
    const data = {couponCode:code,subtotalPaise:b.totalPaise,discountPaise:BigInt(breakdown.discountPaise),finalPaise:BigInt(breakdown.totalPaise),
      breakdown:breakdown as unknown as Prisma.InputJsonValue};
    return tx.bookingPricingQuote.upsert({where:{bookingId:b.id},create:{bookingId:b.id,...data},update:data});
  }
  async freeze(tx: Prisma.TransactionClient, b: Booking) {
    await this.userLock(tx,b.userId);
    if (b.pricingVersion===0) {
      // Legacy/full-price payments do not redeem FIRST50. An uncertain order
      // keeps its offer reservation, but must not block unrelated purchases.
      return b.totalPaise;
    }
    const old = await tx.bookingPricingQuote.findUnique({where:{bookingId:b.id}});
    const quote = await this.price(tx,b,old?.couponCode??null);
    await this.assertPaymentAllowed(tx,quote.breakdown);
    if (quote.couponCode==='FIRST50') {
      const reservation = await tx.firstBookingOffer.findUnique({where:{userId:b.userId}});
      if (reservation?.reservedBookingId!==b.id || reservation.consumedAt) throw firstError();
    }
    if (!quote.frozenAt) await tx.bookingPricingQuote.update({where:{bookingId:b.id},data:{frozenAt:await this.clock(tx)}});
    return quote.finalPaise;
  }
  readOrChange(userId: string, id: string, code?: string | null) {
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id=${id}::uuid FOR UPDATE`);
      const b = await tx.booking.findUnique({where:{id}});
      if (!b || b.userId!==userId) throw new AppError(404,'NOT_FOUND','Booking not found.');
      const q = await tx.bookingPricingQuote.findUnique({where:{bookingId:id}});
      if (code===undefined && q?.frozenAt) {
        const saved = q.breakdown as unknown as {simulated?:boolean};
        return { ...q.breakdown as object, ...(saved.simulated ? {paymentAllowed:['controlled-test','razorpay-test'].includes(this.context) && await this.allowSimulation(tx)} : {}), frozen:true };
      }
      if (b.pricingVersion===0) {
        if (code!==undefined) throw new AppError(409,'LEGACY_QUOTE','Existing bookings keep their original prices.');
        return {version:0,label:'Order summary',couponCode:null,totalPaise:Number(b.totalPaise),subtotalPaise:Number(b.totalPaise),frozen:true};
      }
      const result = await this.price(tx,b,code===undefined?q?.couponCode??null:code);
      return { ...result.breakdown as object, frozen:!!result.frozenAt };
    },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,timeout:7000});
  }
}
