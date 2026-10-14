import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { resolveDevTarget, verifyDatabaseIdentity } from '../scripts/dev-target.js';
import { importTmdbMovie } from './dev-seed-tmdb-core.js';

async function main() {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  if (process.env.NODE_ENV !== 'development') throw new Error('TMDB import requires NODE_ENV=development.');
  if (!process.env.TMDB_READ_ACCESS_TOKEN) { console.log('TMDB import unavailable: no server-side token configured.'); return; }
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--movie-id' || args[2] !== '--tmdb-id') throw new Error('Provide --movie-id <UUID> --tmdb-id <integer>.');
  const target = resolveDevTarget(process.env);
  const pool = new pg.Pool({ connectionString: target.url, max: 1, connectionTimeoutMillis: 2000 });
  try { await verifyDatabaseIdentity(pool, target); } finally { await pool.end(); }
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([import('../src/generated/prisma/client.js'), import('@prisma/adapter-pg')]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, connectionTimeoutMillis: 2000 }) });
  try {
    const result = await importTmdbMovie({ findById: id => prisma.movie.findUnique({ where: { id } }),
      update: (id, data) => prisma.movie.update({ where: { id }, data }) }, {
      nodeEnv: process.env.NODE_ENV, token: process.env.TMDB_READ_ACCESS_TOKEN, movieId: args[1]!, tmdbId: Number(args[3]), includeTrailer: true });
    console.log(`TMDB development import: ${result.status}.`);
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('TMDB import stopped safely. Check development target, exact IDs and provider configuration.'); process.exitCode = 1; });
