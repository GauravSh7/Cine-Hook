import 'dotenv/config';
import pg from 'pg';
import {createPrisma} from '../src/lib/prisma.js';
import {cinemaSimulationPolicy,eventSimulationPolicy} from '../src/modules/pricing/cinema-simulation.js';
import type {TaxPolicy} from '../src/modules/pricing/pricing-engine.js';
import {resolveDevTarget,verifyDatabaseIdentity} from './dev-target.js';

async function main() {
  const target=resolveDevTarget(process.env);
  const pool=new pg.Pool({connectionString:target.url});
  try {await verifyDatabaseIdentity(pool,target);} finally {await pool.end();}
  const prisma=createPrisma(target.url);
  try {
    const result=await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261013)`;
      const theatres=await tx.theatre.findMany({select:{id:true}});
      const events=await tx.event.findMany({where:{isActive:true,kind:{in:['EVENTS','SPORTS','ACTIVITIES']}},select:{id:true}});
      const [clock]=await tx.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AS now`;
      const waiverStartsAt=clock!.now.toISOString();
      let added=0,retained=0,updated=0;
      const targets=[...theatres.map(t=>({prefix:`movie:${t.id}:`,policy:cinemaSimulationPolicy})),...events.map(e=>({prefix:`event:${e.id}:`,policy:eventSimulationPolicy}))];
      for(const target of targets) {
        const {prefix}=target;
        // Do not replace an existing operator policy or any financial history.
        const existing=await tx.pricingTaxPolicy.findMany({where:{key:{startsWith:prefix}}});
        if(existing.length) {
          const owned=existing.length===1 && existing[0]!.key===`${prefix}simulation-v1` ? existing[0] : undefined;
          const settings=owned?.settings as unknown as TaxPolicy | undefined;
          if(owned && settings?.simulation?.kind==='DEVELOPMENT_TEST' && settings.verified===false && settings.feeVerified===false && !settings.feeWaiverStartsAt) {
            await tx.pricingTaxPolicy.update({where:{key:owned.key},data:{settings:{...settings,feeWaiverStartsAt:waiverStartsAt}}});updated++;
          } else retained++;
          continue;
        }
        await tx.pricingTaxPolicy.create({data:{key:`${prefix}simulation-v1`,
          verifiedBy:'Approved development simulation assumptions; NOT a tax reviewer',settings:{...target.policy,feeWaiverStartsAt:waiverStartsAt}}});
        added++;
      }
      return {added,retained,updated};
    });
    console.log(JSON.stringify({database:'cinehook_dev',port:5432,simulation:true,...result,providerPaymentsEnabled:false}));
  } finally {await prisma.$disconnect();}
}
main().catch(()=>{console.error('Simulation setup stopped safely. Verify the local cinehook_dev target and database permissions.');process.exitCode=1;});
