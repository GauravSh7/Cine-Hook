import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import pg from 'pg';
import { resolveDevTarget, verifyDatabaseIdentity } from '../scripts/dev-target.js';
import { seedId } from './dev-seed-manifest.js';

type DirectoryCity = { geonameId: number; name: string; state: string };

async function main() {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  if (process.env.NODE_ENV !== 'development') throw new Error('Location catalogue updates require development mode.');
  const target = resolveDevTarget(process.env);
  const pool = new pg.Pool({ connectionString: target.url, max: 1, connectionTimeoutMillis: 2000 });
  try { await verifyDatabaseIdentity(pool, target); } finally { await pool.end(); }
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([import('../src/generated/prisma/client.js'), import('@prisma/adapter-pg')]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, options: '-c timezone=UTC', connectionTimeoutMillis: 2000 }) });
  try {
    const directory = JSON.parse(await readFile(fileURLToPath(new URL('./india-city-directory.json', import.meta.url)), 'utf8')) as DirectoryCity[];
    if (!Array.isArray(directory) || directory.length < 6000 || directory.some(city => !Number.isSafeInteger(city.geonameId) || !city.name?.trim() || !city.state?.trim())) throw new Error('The India city directory did not pass validation.');
    const result = await prisma.$transaction(async tx => {
      const identity = (await tx.$queryRaw<Array<{ database: string; schema: string; port: number }>>`SELECT current_database() AS database, current_schema() AS schema, inet_server_port() AS port`)[0];
      if (identity?.database !== 'cinehook_dev' || identity.schema !== 'public' || identity.port !== 5432) throw new Error('Development database identity mismatch.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1667853941, 1936024933)`;
      const existing = await tx.city.findMany({ where: { countryCode: 'IN' }, select: { id: true, name: true, state: true } });
      const knownNames = new Set(existing.map(city => `${city.state.trim().toLocaleLowerCase()}|${city.name.trim().toLocaleLowerCase()}`));
      const knownIds = new Map(existing.map(city => [city.id, city]));
      const additions: { id: string; name: string; state: string; countryCode: string }[] = [];
      for (const city of directory) {
        const id = seedId(`city:geonames:${city.geonameId}`);
        const collision = knownIds.get(id);
        if (collision && (collision.name.toLowerCase() !== city.name.toLowerCase() || collision.state.toLowerCase() !== city.state.toLowerCase())) throw new Error('A location identifier conflicts with an existing record.');
        const uniqueName = `${city.state.trim().toLocaleLowerCase()}|${city.name.trim().toLocaleLowerCase()}`;
        if (knownNames.has(uniqueName)) continue;
        knownNames.add(uniqueName);
        additions.push({ id, name: city.name.trim(), state: city.state.trim(), countryCode: 'IN' });
      }
      const created = additions.length ? (await tx.city.createMany({ data: additions, skipDuplicates: true })).count : 0;
      return { directoryEntries: directory.length, created, preservedExisting: existing.length };
    }, { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 30000 });
    console.log(JSON.stringify({ database: target.database, ...result }));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('Location catalogue update stopped safely. Verify the local development database.'); process.exitCode = 1; });
