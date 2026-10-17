import {readFile,writeFile,mkdir,stat,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {userInfo} from 'node:os';
import dotenv from 'dotenv';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../src/generated/prisma/client.js';
import {resolveStagingTarget,verifyStagingIdentity,verifyStagingBackend} from './staging-target.js';
import {readCatalogue} from './staging-parity.js';
import {digest} from './staging-shape.js';
import {inspectCatalogue,applyCatalogue,stagingTransactionOptions} from './staging-catalogue-core.js';
import {enhancementArguments,decodeEnhancementGroups,validateEnhancement} from './staging-enhancement-core.js';
import {dependencyErrorDetails} from '../src/lib/dependency-diagnostics.js';

const directory=new URL('../.staging-parity/enhancement-v1/',import.meta.url),run=promisify(execFile);
let phase='arguments';
async function main(){
  const args=enhancementArguments(process.argv.slice(2));
  const load=async(name:string)=>JSON.parse(await readFile(new URL(name,directory),'utf8'));
  const preview=await load('preview.json'),{approvalHash,...approvedReport}=preview;
  const baseline=decodeEnhancementGroups(await load('baseline.json')),patch=decodeEnhancementGroups(await load('patch.json'));
  if(digest(approvedReport)!==approvalHash||digest(baseline)!==preview.baselineHash||digest(patch)!==preview.patchHash||args.apply&&args.approvedHash!==approvalHash)throw new Error('Enhancement artifact or approval hash mismatch.');
  const target=resolveStagingTarget({...dotenv.parse(await readFile(new URL('../.env.staging',import.meta.url))),NODE_TLS_REJECT_UNAUTHORIZED:process.env.NODE_TLS_REJECT_UNAUTHORIZED});
  if(target.fingerprint!==preview.targetFingerprint)throw new Error('Enhancement target differs.');
  phase='hosted-guard';await verifyStagingBackend(target);
  const migrations=(await readdir(new URL('../prisma/migrations/',import.meta.url),{withFileTypes:true})).filter(d=>d.isDirectory()).map(d=>d.name);
  // The shared guard requires staging, blocks live-money and verifies the exact fingerprint.
  // TEST checkout may remain disabled; catalogue approval never changes payment configuration.
  phase='media';
  for(const movie of patch.find(g=>g.model==='movie')!.rows){
    for(const url of [movie.posterUrl,movie.backdropUrl,`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${movie.trailerVideoId}`)}&format=json`]){
      const value=String(url);if(!/^https:\/\/(image\.tmdb\.org|www\.youtube\.com)\//.test(value))throw new Error('Enhancement media rejected.');
      if(!(await fetch(value,{signal:AbortSignal.timeout(15000),redirect:'error'})).ok)throw new Error('Enhancement media unavailable.');
    }
  }
  let checkpoint:unknown=null;
  if(args.apply){
    phase='recovery';
    // Complete private custom archive. Never restore automatically; never put credentials in argv.
    const folder=`C:/Users/gaura/.codex/private-backups/cinehook-staging/enhancement-${Date.now()}-${approvalHash.slice(0,12)}`;
    await mkdir(folder,{recursive:true});await run('icacls',[folder,'/inheritance:r','/grant:r',`${userInfo().username}:(OI)(CI)F`,'SYSTEM:(OI)(CI)F']);
    const url=new URL(target.url),env={...process.env,PGHOST:url.hostname,PGPORT:'5432',PGDATABASE:target.database,PGUSER:target.role,PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:'verify-full',PGSSLROOTCERT:'C:/Users/gaura/.codex/private-backups/cinehook-staging/2026-10-15-pre-catalogue/trusted-ca.pem'};
    const archive=`${folder}/before-enhancement.dump`,bin='C:/Program Files/PostgreSQL/18/bin/';
    await run(`${bin}pg_dump.exe`,['--format=custom','--file',archive,'--no-owner','--no-acl'],{env,timeout:180000});
    await run(`${bin}pg_restore.exe`,['--list',archive],{timeout:30000,maxBuffer:10*1024*1024});
    await run(`${bin}pg_restore.exe`,['--file=NUL',archive],{timeout:60000,maxBuffer:1024*1024});
    const archiveHash=createHash('sha256').update(await readFile(archive)).digest('hex');
    checkpoint={archive,archiveHash,bytes:(await stat(archive)).size,targetFingerprint:target.fingerprint,approvalHash,capturedAt:new Date(),restoreExecuted:false};
    await writeFile(`${folder}/checkpoint.json`,JSON.stringify(checkpoint,null,2));
  }
  const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:target.url,max:1,connectionTimeoutMillis:45000,options:`-c timezone=UTC -c statement_timeout=30000${args.apply?'':' -c default_transaction_read_only=on'}`})});
  try{
    phase='transaction';
    const result=await prisma.$transaction(async tx=>{
      if(!args.apply)await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const [identity]=await tx.$queryRaw<Array<{database:string;role:string;schema:string;port:number}>>`SELECT current_database() AS database,current_user AS role,current_schema() AS schema,inet_server_port() AS port`;
      verifyStagingIdentity(target,identity);
      const appliedMigrations=await tx.$queryRaw<Array<{migration_name:string}>>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      if(migrations.some(name=>!appliedMigrations.some(m=>m.migration_name===name)))throw new Error('Enhancement migrations missing.');
      if(args.apply){await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");await tx.$executeRaw`SELECT pg_advisory_xact_lock(1667853941,1937006967)`;await tx.$executeRawUnsafe('LOCK TABLE movies,shows,show_seat_prices IN SHARE ROW EXCLUSIVE MODE');}
      const [clock]=await tx.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AS now`;
      const current=await readCatalogue(tx);validateEnhancement(baseline,patch,current,clock!.now);
      const protectedCounts=async()=>({users:await tx.user.count(),bookings:await tx.booking.count(),payments:await tx.payment.count(),refunds:await tx.refund.count()});
      const before=await protectedCounts(),plan=await inspectCatalogue(tx,patch);
      if(args.apply){await applyCatalogue(tx,plan);await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');validateEnhancement(baseline,patch,await readCatalogue(tx),clock!.now);const repeat=await inspectCatalogue(tx,patch);if(Object.values(repeat.createCounts).some(n=>n!==0)||digest(before)!==digest(await protectedCounts()))throw new Error('Enhancement post-write verification failed.');}
      return {mode:args.apply?'apply':'dry-run',targetFingerprint:target.fingerprint,approvalHash,patchHash:preview.patchHash,toCreate:plan.createCounts,databaseWrites:args.apply?Object.values(plan.createCounts).reduce((a,b)=>a+b,0):0,checkpoint};
    },stagingTransactionOptions(args.apply?'apply':'dry-run'));
    console.log(JSON.stringify(result));
    if(args.apply)await writeFile(new URL('apply-result.json',directory),JSON.stringify(result,null,2));
  }finally{await prisma.$disconnect();}
}
main().catch(error=>{console.error(JSON.stringify({event:'enhancement_stopped',phase,...dependencyErrorDetails(error),message:error instanceof Error&&/^Enhancement /.test(error.message)?error.message:'Enhancement stopped safely; no raw provider diagnostics are logged.'}));process.exitCode=1;});
