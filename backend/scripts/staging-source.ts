import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../src/generated/prisma/client.js';
import {resolveDevTarget} from './dev-target.js';
import {buildParitySnapshot,readCatalogue} from './staging-parity.js';

export async function readLocalParitySnapshot(){
  // Parse into a private object: source .env never overrides the Neon target or process environment.
  const local=dotenv.parse(await readFile(fileURLToPath(new URL('../.env',import.meta.url))));
  const target=resolveDevTarget(local);
  const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:target.url,max:1,connectionTimeoutMillis:10000,options:'-c timezone=UTC -c statement_timeout=30000'})});
  try{return await prisma.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [identity]=await tx.$queryRaw<Array<{database:string;schema:string;port:number}>>`SELECT current_database() AS database,current_schema() AS schema,inet_server_port() AS port`;
    if(identity?.database!=='cinehook_dev'||identity.schema!=='public'||identity.port!==5432)throw new Error('Local catalogue source identity mismatch.');
    const [clock]=await tx.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AS now`;
    return buildParitySnapshot(await readCatalogue(tx),clock!.now);
  },{isolationLevel:'RepeatableRead',maxWait:10000,timeout:180000});}
  finally{await prisma.$disconnect();}
}
