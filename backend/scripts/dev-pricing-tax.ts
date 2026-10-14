import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {z} from 'zod';
import {resolveDevTarget,verifyDatabaseIdentity} from './dev-target.js';
import {createPrisma} from '../src/lib/prisma.js';
const state=z.string().regex(/^(0[1-9]|[12][0-9]|3[0-8])$/);
const policy=z.object({classification:z.enum(['CINEMA','ADMISSION_18','RECOGNISED_SPORT','IPL_LIKE','EXEMPT']),effectiveFrom:z.iso.datetime({offset:true}),effectiveTo:z.iso.datetime({offset:true}).nullable(),
  verified:z.literal(true),source:z.string().min(20).max(1000),supplierState:state,supplyState:state,feeSupplierState:state,feeSupplyState:state,
  feeRateBps:z.union([z.literal(0),z.literal(1800)]),feeSource:z.string().min(20).max(1000),feeVerified:z.literal(true)}).strict();
const schema=z.array(z.object({targetKind:z.enum(['movie','event']),targetId:z.uuid(),verifiedBy:z.string().min(3).max(200),settings:policy}).strict()).min(1).max(100);
async function main() {
  const target=resolveDevTarget(process.env),file=process.env.PRICING_TAX_CONFIG_FILE;
  if(!file)throw new Error('Provide PRICING_TAX_CONFIG_FILE containing operator-verified tax settings.');
  const entries=schema.parse(JSON.parse(await readFile(file,'utf8')));
  const pool=new pg.Pool({connectionString:target.url});try{await verifyDatabaseIdentity(pool,target);}finally{await pool.end();}
  const prisma=createPrisma(target.url);
  try{await prisma.$transaction(async tx=>{
    for(const row of entries){
      if(row.settings.effectiveTo && Date.parse(row.settings.effectiveTo)<=Date.parse(row.settings.effectiveFrom))throw new Error('Invalid tax period.');
      if(row.targetKind==='movie' && row.settings.classification!=='CINEMA')throw new Error('Cinema targets require cinema admission classification.');
      const exists=row.targetKind==='movie'?await tx.theatre.findUnique({where:{id:row.targetId}}):await tx.event.findUnique({where:{id:row.targetId}});
      if(!exists)throw new Error('Tax target does not exist in the verified development database.');
      const key=`${row.targetKind}:${row.targetId}:${row.settings.effectiveFrom.slice(0,10)}`;
      await tx.pricingTaxPolicy.upsert({where:{key},create:{key,settings:row.settings,verifiedBy:row.verifiedBy},update:{settings:row.settings,verifiedBy:row.verifiedBy}});
    }
  });console.log(`Saved ${entries.length} operator-reviewed development tax policies. Frozen quotes unchanged.`);
  }finally{await prisma.$disconnect();}
}
main().catch(()=>{console.error('Tax configuration stopped safely. Check file validation, verification fields and the guarded cinehook_dev target.');process.exitCode=1;});
