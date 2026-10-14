import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { resolveDevTarget, verifyDatabaseIdentity } from '../scripts/dev-target.js';
import { promptAdminPassword } from '../scripts/dev-password.js';
import { DEV_ADMIN } from './dev-seed-manifest.js';

async function main(): Promise<void> {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  const target = resolveDevTarget(process.env); // Guard before either database client is constructed.
  const pool = new pg.Pool({ connectionString: target.url, connectionTimeoutMillis: 2000, max: 1 });
  let needsPassword = false;
  try {
    await verifyDatabaseIdentity(pool, target);
    const existing = await pool.query('SELECT id,email,role FROM users WHERE id=$1 OR email=$2', [DEV_ADMIN.id, DEV_ADMIN.email]);
    needsPassword = existing.rowCount === 0;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Development database identity')) throw error;
    throw new Error('Cannot prepare development admin. Create cinehook_dev owned by the app role and run npm run dev:db:migrate first.');
  } finally { await pool.end(); }
  const password = needsPassword ? (process.env.DEV_ADMIN_PASSWORD || await promptAdminPassword()) : undefined;
  // Dynamic import keeps client setup behind both guards and password intake.
  const [{ PrismaClient }, { PrismaPg }, { seedDevelopment }] = await Promise.all([
    import('../src/generated/prisma/client.js'), import('@prisma/adapter-pg'), import('./dev-seed-core.js'),
  ]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, options: '-c timezone=UTC', connectionTimeoutMillis: 2000 }) });
  try {
    const result = await seedDevelopment(prisma, { expectedDatabase: target.database, expectedPort: target.port, password });
    console.log('LOCAL DEVELOPMENT inventory seeded in cinehook_dev. Created rows:', result.created);
    console.log('Development admin: admin@cinehook.local. Existing credentials and user data were preserved.');
  } finally { await prisma.$disconnect(); }
}
main().catch(error => {
  const message = error instanceof Error ? error.message : '';
  console.error(/^(This explicit development|A valid local|Configure a local|Development|Explicit development|Cannot prepare|First development|Existing development|Existing scheduled|Invalid development)/.test(message)
    ? message : 'Development seed stopped safely; check the dedicated database schema, permissions and conflicting development inventory.');
  process.exitCode = 1;
});
