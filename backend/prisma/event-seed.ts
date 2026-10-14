import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { resolveDevTarget, verifyDatabaseIdentity } from '../scripts/dev-target.js';

/** Only the explicit npm dev command executes this file. No migration or server imports it. */
async function main(): Promise<void> {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  const target = resolveDevTarget(process.env);
  const pool = new pg.Pool({ connectionString: target.url, max: 1, connectionTimeoutMillis: 2000, options: '-c timezone=UTC' });
  try { await verifyDatabaseIdentity(pool, target); } finally { await pool.end(); }
  const [{ createPrisma }, { seedEvents }] = await Promise.all([
    import('../src/lib/prisma.js'), import('./event-seed-core.js'),
  ]);
  const prisma = createPrisma(target.url);
  try { console.log('Fictional development event inventory:', await seedEvents(prisma, { expectedDatabase: target.database, expectedPort: target.port })); }
  finally { await prisma.$disconnect(); }
}
main().catch(() => {
  console.error('Event seed stopped safely. Check guarded cinehook_dev target, migrations, existing supported cities and identity/layout collisions.');
  process.exitCode = 1;
});
