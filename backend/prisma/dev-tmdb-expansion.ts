import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { resolveDevTarget, verifyDatabaseIdentity } from '../scripts/dev-target.js';
import { seedAdditionalMovies } from './dev-movie-expansion.js';

async function main(){
  dotenv.config({path:fileURLToPath(new URL('../.env',import.meta.url)),quiet:true});
  if(process.env.NODE_ENV!=='development')throw new Error('Movie expansion requires development mode.');
  const token=process.env.TMDB_READ_ACCESS_TOKEN;if(!token)throw new Error('TMDB provider configuration is required.');
  const target=resolveDevTarget(process.env),pool=new pg.Pool({connectionString:target.url,max:1,connectionTimeoutMillis:2000});
  try{await verifyDatabaseIdentity(pool,target)}finally{await pool.end()}
  const [{PrismaClient},{PrismaPg}]=await Promise.all([import('../src/generated/prisma/client.js'),import('@prisma/adapter-pg')]);
  const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:target.url,connectionTimeoutMillis:2000})});
  try{console.log(JSON.stringify({database:target.database,...await seedAdditionalMovies(prisma,token)}))}finally{await prisma.$disconnect()}
}
main().catch(()=>{console.error('Movie catalogue update stopped safely. Check the local development database and TMDB setup.');process.exitCode=1});
