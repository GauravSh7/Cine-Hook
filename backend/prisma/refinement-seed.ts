import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { resolveDevTarget, verifyDatabaseIdentity } from '../scripts/dev-target.js';
async function main() {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  const target = resolveDevTarget(process.env);
  const pool = new pg.Pool({ connectionString: target.url, max: 1, connectionTimeoutMillis: 2000 });
  try { await verifyDatabaseIdentity(pool, target); } finally { await pool.end(); }
  const [{ PrismaClient }, { PrismaPg }, { seedRefinementContent }] = await Promise.all([
    import('../src/generated/prisma/client.js'), import('@prisma/adapter-pg'), import('./refinement-seed-core.js'),
  ]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, connectionTimeoutMillis: 2000 }) });
  try { console.log('Development refinement content:', await seedRefinementContent(prisma, { expectedDatabase: target.database, expectedPort: target.port })); }
  finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('Refinement seed stopped safely. Check guarded cinehook_dev target, migrations and identity collisions.'); process.exitCode = 1; });
