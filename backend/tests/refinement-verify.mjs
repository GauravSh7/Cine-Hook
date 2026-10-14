// Explicit local verification orchestration. No personal database/Redis reset.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { verificationTargets } from './verification-targets.mjs';
const suffix = process.env.REFINEMENT_RUN_SUFFIX;
const names = verificationTargets(suffix);
const url = name => `postgresql://cinehook_verify@127.0.0.1:55438/${name}`;
const admin = new pg.Pool({ connectionString: url('postgres'), max: 1 });
async function run(args, env = {}) {
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: 'inherit' });
  const code = await new Promise(resolve => child.once('close', resolve));
  if (code !== 0) throw new Error(`Verification step exited ${code}.`);
}
try {
  const identity = (await admin.query('SELECT current_database() AS name, current_user AS role, current_schema() AS schema, inet_server_port() AS port')).rows[0];
  assert.deepEqual(identity, { name: 'postgres', role: 'cinehook_verify', schema: 'public', port: 55438 });
  const legacyUrl = process.env.EVENT_SEED_LEGACY_TEST_DATABASE_URL;
  const legacy = new URL(legacyUrl ?? '');
  assert.equal(legacy.hostname, '127.0.0.1'); assert.equal(legacy.port, '55438'); assert.equal(legacy.username, 'cinehook_verify');
  assert.equal(legacy.password, ''); assert.equal(legacy.search, '');
  assert.equal(legacy.pathname, '/cinehook_event_seed_20261011_utc_red_test');
  const old = new pg.Pool({ connectionString: legacyUrl, max: 1 });
  try {
    const actual = (await old.query('SELECT current_database() AS name,current_user AS role,current_schema() AS schema,inet_server_port() AS port')).rows[0];
    assert.deepEqual(actual, { name: legacy.pathname.slice(1), role: 'cinehook_verify', schema: 'public', port: 55438 });
  } finally { await old.end(); }
  for (const name of Object.values(names)) {
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount, 0, 'Use fresh isolated target names. Existing data is never deleted.');
    await admin.query(`CREATE DATABASE "${name}"`);
    await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { DATABASE_URL: url(name), NODE_ENV: 'test' });
  }
  console.log('Migrated isolated verification databases:', names);
  const env = { AUTH_TEST_DATABASE_URL: url(names.core), BOOKING_TEST_DATABASE_URL: url(names.core), PAYMENTS_TEST_DATABASE_URL: url(names.core),
    REFUNDS_TEST_DATABASE_URL: url(names.core), PROFILE_TEST_DATABASE_URL: url(names.core), GOOGLE_AUTH_TEST_DATABASE_URL: url(names.core),
    SEAT_LOCK_TEST_REDIS_URL: 'redis://127.0.0.1:55439/15' };
  // Run the short fixture contract first, releasing 55440 before the long
  // financial suites. The controller may then start the separate browser DB.
  await run(['--test','--test-concurrency=1','tests/ui-browser-native.integration.mjs'], { UI_TEST_DATABASE_URL: url(names.ui_native), SEAT_LOCK_TEST_REDIS_URL: env.SEAT_LOCK_TEST_REDIS_URL });
  await run(['--test', '--test-concurrency=1', 'tests/auth.integration.mjs', 'tests/google-auth.integration.mjs', 'tests/catalog.integration.mjs', 'tests/shows.integration.mjs',
    'tests/booking-database.integration.mjs', 'tests/seat-lock.integration.mjs', 'tests/booking.integration.mjs', 'tests/payments-database.integration.mjs',
    'tests/payments.integration.mjs', 'tests/refunds-database.integration.mjs', 'tests/refunds.integration.mjs', 'tests/profile-wishlist.integration.mjs'], env);
  await run(['--test','--test-concurrency=1','tests/event-inventory.integration.mjs'], { EVENT_TEST_DATABASE_URL: url(names.inventory) });
  await run(['--test','--test-concurrency=1','tests/event-booking.integration.mjs'], { EVENT_TEST_DATABASE_URL: url(names.finance), SEAT_LOCK_TEST_REDIS_URL: env.SEAT_LOCK_TEST_REDIS_URL });
  await run(['--import','tsx','--test','--test-concurrency=1','tests/event-seed.integration.ts'], { EVENT_SEED_TEST_DATABASE_URL: url(names.event_seed), EVENT_SEED_LEGACY_TEST_DATABASE_URL: legacyUrl });
  await run(['--import','tsx','--test','--test-concurrency=1','tests/dev-seed.integration.ts'], { SEED_TEST_DATABASE_URL: url(names.seed), SEED_LAYOUT_TEST_DATABASE_URL: url(names.layout) });
  await run(['--import','tsx','--test','--test-concurrency=1','tests/refinement.integration.ts'], { REFINEMENT_TEST_DATABASE_URL: url(names.content) });
  await run(['--test','--test-concurrency=1','tests/runtime-smoke.mjs']);
  console.log('Fresh native regression/seed/refinement/smoke finished. Browser target:', names.browser);
} finally { await admin.end(); }
