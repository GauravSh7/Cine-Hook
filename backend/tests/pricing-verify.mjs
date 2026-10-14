import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import pg from 'pg';
const suffix=process.env.PRICING_RUN_SUFFIX;
assert.match(suffix??'',/^[a-z0-9_]{1,25}$/);
const name=`cinehook_event_seed_pricing_${suffix}_test`;
const admin=new pg.Pool({connectionString:'postgresql://cinehook_verify@127.0.0.1:55438/postgres',max:1});
const run=async(args,env)=>{const child=spawn(process.execPath,args,{stdio:'inherit',env:{...process.env,...env}});assert.equal(await new Promise(r=>child.once('close',r)),0);};
try {
  const identity=(await admin.query('SELECT current_database() AS name,current_user AS role,current_schema() AS schema,inet_server_port() AS port')).rows[0];
  assert.deepEqual(identity,{name:'postgres',role:'cinehook_verify',schema:'public',port:55438});
  assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount,0,'Use a fresh suffix; never reset a database.');
  await admin.query(`CREATE DATABASE "${name}"`);
  const env={DATABASE_URL:`postgresql://cinehook_verify@127.0.0.1:55438/${name}`,NODE_ENV:'test',PRICING_TEST_DATABASE_URL:`postgresql://cinehook_verify@127.0.0.1:55438/${name}`,SEAT_LOCK_TEST_REDIS_URL:'redis://127.0.0.1:55439/15'};
  await run(['node_modules/prisma/build/index.js','migrate','deploy'],env);
  await run(['--import','tsx','--test','tests/pricing.integration.mjs'],env);
  console.log('Pricing verification database retained:',name);
}finally{await admin.end();}
