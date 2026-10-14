import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { dependencyErrorDetails } from '../src/lib/dependency-diagnostics.js';
import { resolveStagingTarget, verifyStagingIdentity, verifyStagingBackend, parseImportArguments, safeStagingFailureMessage } from './staging-target.js';
import { inventoryCounts } from './staging-manifest.js';
import { inspectCatalogue, applyCatalogue } from './staging-catalogue-core.js';
import { readLocalParitySnapshot } from './staging-source.js';
import { compareCatalogue, decodeParitySnapshot, validateParitySnapshot, readCatalogue } from './staging-parity.js';
import { digest } from './staging-shape.js';
import { auditCatalogueMedia, mediaReviewComplete, type MediaAudit, type MediaPermission } from './staging-media.js';
import { applyContentReview, type ContentReview } from './staging-content.js';

const artifactDirectory=new URL('../.staging-parity/',import.meta.url);
async function privateJson(name:string):Promise<string>{return readFile(new URL(name,artifactDirectory),'utf8');}
async function permissions():Promise<MediaPermission[]>{
  try{const p=JSON.parse(await privateJson('media-permissions.json')) as MediaPermission[];if(!Array.isArray(p))throw new Error('Invalid media review.');return p;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
}

async function main() {
  const args = parseImportArguments(process.argv.slice(2));
  if(args.startDate)throw new Error('Full parity preserves source dates; do not pass --start-date.');
  let snapshot=args.mode==='apply'?decodeParitySnapshot(await privateJson('snapshot.json')):await readLocalParitySnapshot();
  let contentChanges:ReturnType<typeof applyContentReview>['audit']=[],contentReviewHash:string|null=null;
  try{
    const review=JSON.parse(await privateJson('content-review.json')) as ContentReview;
    if(snapshot.capturedAt.getTime()-Date.parse(review.checkedAt)>86400000)throw new Error('Content review is stale; refresh provider evidence.');
    contentReviewHash=digest(review);
    if(args.mode!=='apply'){const reviewed=applyContentReview(snapshot,review);snapshot=reviewed.snapshot;contentChanges=reviewed.audit;validateParitySnapshot(snapshot);}
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const manifest=snapshot.groups;
  if (args.mode === 'offline-plan') {
    const checks=compareCatalogue(snapshot,manifest);
    console.log(JSON.stringify({ mode: 'local-source-plan', databaseVerified: false, sourceVerified:true,capturedAt:snapshot.capturedAt,
      source:snapshot.sourceCounts,exclusions:snapshot.exclusions,planned:inventoryCounts(manifest),metadata:checks.metadata,screenLayouts:checks.layouts.screens.length,eventLayouts:checks.layouts.venues.length }));
    return;
  }
  // Never load .env, fall back to DATABASE_URL, or inherit local seed behavior.
  const dedicated=dotenv.parse(await readFile(fileURLToPath(new URL('../.env.staging', import.meta.url))));
  const target = resolveStagingTarget({...dedicated,NODE_TLS_REJECT_UNAUTHORIZED:process.env.NODE_TLS_REJECT_UNAUTHORIZED});
  const mediaPermissions=await permissions();
  const prior=args.mode==='apply'?JSON.parse(await privateJson('preview.json')) as {media:MediaAudit}:null;
  console.log(JSON.stringify({event:'staging_preview',phase:'media-check',sourceVerified:true,movies:manifest.find(g=>g.model==='movie')!.rows.length}));
  const media=prior?.media??await auditCatalogueMedia(manifest);
  if(args.mode==='dry-run'){
    await mkdir(artifactDirectory,{recursive:true});
    await writeFile(new URL('last-attempt.json',artifactDirectory),JSON.stringify({databaseVerified:false,capturedAt:snapshot.capturedAt,media},null,2));
  }
  if(args.mode==='apply'&&!mediaReviewComplete(media,mediaPermissions))throw new Error('Staging media availability or rights review is incomplete.');
  if (args.mode === 'apply') await verifyStagingBackend(target);
  const migrations = (await readdir(new URL('../prisma/migrations/', import.meta.url), { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, max: 1,
    connectionTimeoutMillis: 45000, options: '-c timezone=UTC -c statement_timeout=30000' }) });
  try {
    console.log(JSON.stringify({event:'staging_preview',phase:'database-read-only',mediaAssets:media.assets.length,failedMedia:media.failed}));
    const result = await prisma.$transaction(async tx => {
      if (args.mode === 'dry-run') await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const [identity] = await tx.$queryRaw<Array<{database: string; role: string; schema: string; port: number}>>`
        SELECT current_database() AS database, current_user AS role, current_schema() AS schema, inet_server_port() AS port`;
      verifyStagingIdentity(target, identity);
      const applied = await tx.$queryRaw<Array<{migration_name: string}>>`
        SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      if (migrations.some(name => !applied.some(row => row.migration_name === name))) throw new Error('Staging schema is missing repository migrations; import stopped.');
      if (args.mode === 'apply') {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(1667853941, 1937006967)`;
      }
      const plan = await inspectCatalogue(tx, manifest);
      const comparison=compareCatalogue(snapshot,await readCatalogue(tx));
      const planHash = digest({target:target.fingerprint,snapshot,pending:plan.groups,media,mediaPermissions,contentReviewHash});
      if (args.mode === 'apply') {
        const [clock]=await tx.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AS now`;
        validateParitySnapshot(snapshot,clock!.now);
        if (args.approvedPlan !== planHash) throw new Error('Staging dry-run plan changed; request a new approval before applying.');
        if(Object.values(comparison.models).some(r=>r.different))throw new Error('Existing catalogue metadata differs; no existing rows may be overwritten.');
        await applyCatalogue(tx, plan);
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
        const after=compareCatalogue(snapshot,await readCatalogue(tx));
        if(Object.values(after.models).some(r=>r.missing||r.different))throw new Error('Staging parity verification failed; transaction must roll back.');
      }
      return { mode: args.mode, databaseVerified: true,sourceVerified:true,capturedAt:snapshot.capturedAt,migrationsVerified:migrations.length,targetFingerprint:target.fingerprint,planHash,
        sourceHash:digest(snapshot),source:snapshot.sourceCounts,exclusions:snapshot.exclusions,planned:inventoryCounts(manifest),toCreate:plan.createCounts,
        comparison,media,contentChanges,contentReviewHash,mediaReviewComplete:mediaReviewComplete(media,mediaPermissions),pricingPoliciesImported:0,
        imported:args.mode==='apply'?plan.createCounts:null };
    }, { isolationLevel:'RepeatableRead',maxWait: 45000, timeout: 180000 });
    if(args.mode==='dry-run'){
      await mkdir(artifactDirectory,{recursive:true});
      await writeFile(new URL('snapshot.json',artifactDirectory),JSON.stringify(snapshot,null,2));
      await writeFile(new URL('preview.json',artifactDirectory),JSON.stringify(result,null,2));
    }
    console.log(JSON.stringify({...result,comparison:{models:Object.fromEntries(Object.entries(result.comparison.models).map(([k,{source,target,missing,different,extra}])=>[k,{source,target,missing,different,extra}])),metadata:result.comparison.metadata,
      screenLayouts:result.comparison.layouts.screens.length,eventLayouts:result.comparison.layouts.venues.length},media:{assets:result.media.assets.length,failed:result.media.failed,rightsReviewRequired:result.media.rightsReviewRequired.length},report:args.mode==='dry-run'?'backend/.staging-parity/preview.json':null}));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => {
  // Print only our fixed diagnostic messages or recognized provider error codes.
  const message = safeStagingFailureMessage(error);
  console.error(JSON.stringify({ event: 'staging_import_failed', message, ...dependencyErrorDetails(error) }));
  process.exitCode = 1;
});
