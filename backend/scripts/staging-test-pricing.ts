import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { resolveDevTarget, verifyDatabaseIdentity } from './dev-target.js';
import { resolveStagingTarget, verifyStagingIdentity } from './staging-target.js';
import { catalogueTargetFingerprint } from '../src/lib/catalogue-stage.js';
import type { TaxPolicy } from '../src/modules/pricing/pricing-engine.js';

const backend = new URL('../', import.meta.url);
const catalogueKinds = ['EVENTS', 'SPORTS', 'ACTIVITIES'] as const;
const fail = (message: string): never => { throw new Error(message); };
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
});
type PolicyRow = { key: string; verifiedBy: string; settings: Prisma.JsonValue };
type PolicyTemplate = { settings: TaxPolicy; verifiedBy: string };

async function envFile(name: string) {
  return dotenv.parse(await readFile(fileURLToPath(new URL(name, backend)), 'utf8'));
}

async function localTemplates(env: Record<string, string>) {
  const target = resolveDevTarget(env);
  const pool = new pg.Pool({ connectionString: target.url, connectionTimeoutMillis: 10000, max: 1 });
  try { await verifyDatabaseIdentity(pool, target); }
  finally { await pool.end(); }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, max: 2, connectionTimeoutMillis: 10000 }) });
  try {
    return await prisma.$transaction(async tx => {
      const theatres = await tx.theatre.findMany({ select: { id: true } });
      const events = await tx.event.findMany({ where: { isActive: true, kind: { in: [...catalogueKinds] } }, select: { id: true, kind: true } });
      const targets = [
        ...theatres.map(row => ({ prefix: `movie:${row.id}:`, category: 'movie' as const })),
        ...events.map(row => ({ prefix: `event:${row.id}:`, category: 'event' as const })),
      ];
      if (!theatres.length || !events.length) fail('Local pricing source is incomplete; no staging policy was prepared.');
      const templates: { movie?: PolicyTemplate; event?: PolicyTemplate } = {};
      for (const target of targets) {
        const rows = await tx.pricingTaxPolicy.findMany({ where: { key: { startsWith: target.prefix } } });
        if (rows.length !== 1 || rows[0]!.key !== `${target.prefix}simulation-v1`) fail('Local TEST pricing policy set is not the expected complete simulation set.');
        const row = rows[0]! as PolicyRow;
        const policy = row.settings as unknown as TaxPolicy;
        const expectedClassification = target.category === 'movie' ? 'CINEMA' : 'ADMISSION_18';
        const expectedRule = target.category === 'movie' ? 'ORIGINAL_INCLUSIVE_TICKET' : 'FLAT_ADMISSION_18';
        if (policy.classification !== expectedClassification || policy.simulation?.kind !== 'DEVELOPMENT_TEST'
          || policy.simulation.bracketRule !== expectedRule || policy.verified !== false || policy.feeVerified !== false
          || !policy.feeWaiverStartsAt || !row.verifiedBy) fail('Local TEST pricing policy differs from the approved simulation assumptions.');
        const template = { settings: policy, verifiedBy: row.verifiedBy };
        const previous = templates[target.category];
        if (previous && canonical(previous) !== canonical(template)) fail('Local TEST pricing policies disagree; no staging policy was prepared.');
        templates[target.category] = template;
      }
      return { targets, templates };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  } finally { await prisma.$disconnect(); }
}

async function verifyBackend(target: ReturnType<typeof resolveStagingTarget>) {
  const response = await fetch(`${target.backendOrigin}/api/catalogue/status`, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  const body = await response.json() as { data?: { mode?: string; newPaymentsAllowed?: boolean; testPaymentsAllowed?: boolean; targetFingerprint?: string } };
  if (!response.ok || body.data?.mode !== 'staging' || body.data.newPaymentsAllowed !== false
    || body.data.testPaymentsAllowed !== true || body.data.targetFingerprint !== target.fingerprint)
    fail('Hosted TEST checkout guard or database fingerprint is not active; pricing was not written.');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply') || args.filter(arg => arg === '--apply').length > 1) fail('Use no option for a read-only preview or --apply after the hosted TEST guard is active.');
  const apply = args.includes('--apply');
  const [localEnv, stagingEnv] = await Promise.all([envFile('.env'), envFile('.env.staging')]);
  const local = await localTemplates(localEnv);
  const target = resolveStagingTarget({ ...stagingEnv, NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED });
  if (target.fingerprint !== 'b644127b064eab5021e1f1075f6ab6e76383acb29bb978e12c7af626094e5c9a') fail('Staging pricing target does not match the approved Neon identity.');
  if (apply) await verifyBackend(target);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, max: 2, connectionTimeoutMillis: 20000,
    options: '-c timezone=UTC -c statement_timeout=30000' }) });
  try {
    const result = await prisma.$transaction(async tx => {
      const [identity] = await tx.$queryRaw<Array<{ database: string; role: string; schema: string; port: number }>>`
        SELECT current_database() AS database,current_user AS role,current_schema() AS schema,inet_server_port() AS port`;
      verifyStagingIdentity(target, identity);
      if (apply) {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(1667853941,1937006967)`;
      }
      const theatres = await tx.theatre.findMany({ select: { id: true } });
      const events = await tx.event.findMany({ where: { isActive: true, kind: { in: [...catalogueKinds] } }, select: { id: true, kind: true } });
      if (theatres.length !== local.targets.filter(item => item.category === 'movie').length
        || events.length !== local.targets.filter(item => item.category === 'event').length) fail('Staging catalogue target counts differ from the local policy source.');
      const targets = [
        ...theatres.map(row => ({ prefix: `movie:${row.id}:`, template: local.templates.movie! })),
        ...events.map(row => ({ prefix: `event:${row.id}:`, template: local.templates.event! })),
      ];
      let toCreate = 0, retained = 0;
      for (const item of targets) {
        const existing = await tx.pricingTaxPolicy.findMany({ where: { key: { startsWith: item.prefix } } });
        const expectedKey = `${item.prefix}simulation-v1`;
        if (existing.length) {
          if (existing.length !== 1 || existing[0]!.key !== expectedKey || existing[0]!.verifiedBy !== item.template.verifiedBy
            || canonical(existing[0]!.settings) !== canonical(item.template.settings)) fail('A staging pricing policy already differs; no policy was overwritten.');
          retained++;
          continue;
        }
        if (apply) await tx.pricingTaxPolicy.create({ data: { key: expectedKey, settings: item.template.settings as unknown as Prisma.InputJsonValue,
          verifiedBy: item.template.verifiedBy } });
        toCreate++;
      }
      return { databaseVerified: true, targetFingerprint: target.fingerprint, mode: apply ? 'applied' : 'dry-run',
        localMovieTargets: local.targets.filter(item => item.category === 'movie').length,
        localEventTargets: local.targets.filter(item => item.category === 'event').length,
        stagingMovieTargets: theatres.length, stagingEventTargets: events.length, policiesToCreate: toCreate, policiesRetained: retained };
    }, { isolationLevel: apply ? Prisma.TransactionIsolationLevel.ReadCommitted : Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 20000, timeout: 60000 });
    console.log(JSON.stringify(result));
  } finally { await prisma.$disconnect(); }
}

main().catch(error => {
  const known = error instanceof Error ? error.message : '';
  const safe = new Set(['Invalid staging target. Configure the dedicated STAGING_* settings; credentials are never logged.',
    'Staging database identity mismatch; import stopped.','Local TEST pricing source is incomplete; no staging policy was prepared.',
    'Local TEST pricing policy set is not the expected complete simulation set.','Local TEST pricing policy differs from the approved simulation assumptions.',
    'Local TEST pricing policies disagree; no staging policy was prepared.','Staging pricing target does not match the approved Neon identity.',
    'Hosted TEST checkout guard or database fingerprint is not active; pricing was not written.',
    'Use no option for a read-only preview or --apply after the hosted TEST guard is active.',
    'Staging catalogue target counts differ from the local policy source.','A staging pricing policy already differs; no policy was overwritten.']);
  console.error(safe.has(known) ? known : 'Staging TEST pricing setup stopped safely; credentials and provider details were not logged.');
  process.exitCode = 1;
});
