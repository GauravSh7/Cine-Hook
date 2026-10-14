import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
const name = `cinehook_large_halls_${Date.now()}_test`;
const admin = new pg.Pool({ connectionString:'postgresql://cinehook_verify@127.0.0.1:55438/postgres',connectionTimeoutMillis:2000,max:1 });
try {
  const identity=(await admin.query('SELECT current_database() AS name,current_user AS role,inet_server_port() AS port')).rows[0];
  assert.deepEqual(identity,{name:'postgres',role:'cinehook_verify',port:55438});
  await admin.query(`CREATE DATABASE "${name}"`);
  const url=`postgresql://cinehook_verify@127.0.0.1:55438/${name}`;
  const env={...process.env,DATABASE_URL:url,LARGE_HALL_TEST_DATABASE_URL:url,NODE_ENV:'test'};
  for (const args of [['node_modules/prisma/build/index.js','migrate','deploy'],['--import','tsx','--test','tests/dev-large-halls.integration.ts']]) {
    const run=spawnSync(process.execPath,args,{env,stdio:'inherit'}); assert.equal(run.status,0);
  }
  console.log(`Verified isolated database ${name}; retained for inspection.`);
} finally { await admin.end(); }
