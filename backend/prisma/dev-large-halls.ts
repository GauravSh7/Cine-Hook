import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { resolveDevTarget, verifyDatabaseIdentity } from '../scripts/dev-target.js';

async function main() {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  const target = resolveDevTarget(process.env);
  const pool = new pg.Pool({ connectionString: target.url, connectionTimeoutMillis: 2000, max: 1 });
  try { await verifyDatabaseIdentity(pool, target); } finally { await pool.end(); }
  const [{ PrismaClient }, { PrismaPg }, { seedLargeHalls }] = await Promise.all([import('../src/generated/prisma/client.js'), import('@prisma/adapter-pg'), import('./dev-large-halls-core.js')]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, options: '-c timezone=UTC' }) });
  try { console.log(JSON.stringify(await seedLargeHalls(prisma, { expectedDatabase: target.database, expectedPort: target.port }), null, 2)); }
  finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error && /^(Development|Invalid development|This explicit|A valid local|Configure a local|Explicit development)/.test(error.message) ? error.message : 'Development large hall addition stopped safely; inspect local schema and selected inventory.'); process.exitCode = 1; });
