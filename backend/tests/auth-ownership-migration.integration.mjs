import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { seedOwnershipHistory } from './helpers/ownership-history.mjs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import pg from 'pg';

const url = process.env.OWNERSHIP_MIGRATION_TEST_DATABASE_URL;
test('additive ownership migration preserves legacy users and rejects invalid auth versions', { skip: !url }, async () => {
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '55448');
  assert.equal(target.pathname, '/cinehook_ownership_migration_test');
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const identity = (await db.query('select current_database() as name, inet_server_port() as port')).rows[0];
    assert.deepEqual(identity, { name: 'cinehook_ownership_migration_test', port: 55448 });
    assert.equal((await db.query("select count(*)::int as n from information_schema.tables where table_schema='public'")).rows[0].n, 0, 'requires fresh empty isolated database');
    const root = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
    const dirs = (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort();
    for (const name of dirs.filter(n => !n.endsWith('_email_ownership_auth'))) await db.query(await readFile(`${root}/${name}/migration.sql`, 'utf8'));
    const id = '10000000-0000-4000-8000-000000000001';
    await db.query('insert into users(id,name,email,password_hash,role,updated_at) values($1,$2,$3,$4,$5,now())', [id, 'Legacy private profile', 'legacy@example.test', 'opaque-legacy-hash', 'ADMIN']);
    const before = (await db.query('select * from users where id=$1', [id])).rows[0];
    await seedOwnershipHistory(db, id);
    async function fingerprint(connection) {
      const tables = (await connection.query("select tablename from pg_tables where schemaname='public' and tablename<>'account_quarantines' order by tablename")).rows;
      const hash = createHash('sha256');
      for (const { tablename } of tables) {
        const projection = tablename === 'users' ? "to_jsonb(t)-'auth_version'-'auth_disabled_at'-'email_verified_at'" : 'to_jsonb(t)';
        const rows = (await connection.query(`select ${projection} AS record from "${tablename.replaceAll('"','""')}" t order by (${projection})::text`)).rows;
        hash.update(JSON.stringify([tablename, rows]));
      }
      return hash.digest('hex');
    }
    const baselineFingerprint = await fingerprint(db);
    const backupDirectory = await mkdtemp(join(tmpdir(), 'cinehook-auth-recovery-'));
    const backupPath = join(backupDirectory, 'premigration.dump');
    const childEnv = { ...process.env, PGHOST: target.hostname, PGPORT: target.port, PGUSER: decodeURIComponent(target.username), PGPASSWORD: decodeURIComponent(target.password), PGDATABASE: 'cinehook_ownership_migration_test' };
    const executable = name => process.env.OWNERSHIP_PG_BIN ? join(process.env.OWNERSHIP_PG_BIN, name + (process.platform === 'win32' ? '.exe' : '')) : name;
    execFileSync(executable('pg_dump'), ['-Fc','-f',backupPath], { env: childEnv, stdio: 'pipe' });
    for (const name of dirs.filter(n => n.endsWith('_email_ownership_auth'))) await db.query(await readFile(`${root}/${name}/migration.sql`, 'utf8'));
    const after = (await db.query('select * from users where id=$1', [id])).rows[0];
    assert.equal(after.auth_version, 0);
    assert.equal(after.email_verified_at, null);
    assert.equal(after.auth_disabled_at, null);
    for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key], `legacy ${key} preserved`);
    assert.equal(await fingerprint(db), baselineFingerprint, 'every legacy row including financial evidence unchanged');
    await assert.rejects(db.query('update users set auth_version=-1 where id=$1', [id]), { code: '23514' });
    const fk = (await db.query("select confdeltype from pg_constraint where conrelid='account_quarantines'::regclass and contype='f'")).rows;
    assert.equal(fk.length, 2);
    assert.ok(fk.every(row => row.confdeltype === 'r'), 'quarantine provenance blocks deletion');
    await db.query('begin');
    await db.query('update users set auth_version=auth_version+1 where id=$1', [id]);
    await db.query('rollback');
    assert.equal((await db.query('select auth_version from users where id=$1', [id])).rows[0].auth_version, 0);
    const restoreDatabase = `cinehook_ownership_restore_${randomUUID().replaceAll('-','').slice(0,12)}_test`;
    await db.query(`CREATE DATABASE "${restoreDatabase}"`);
    execFileSync(executable('pg_restore'), ['--exit-on-error','-d',restoreDatabase,backupPath], { env: childEnv, stdio: 'pipe' });
    const restoredTarget = new URL(url); restoredTarget.pathname = `/${restoreDatabase}`;
    const restored = new pg.Client({ connectionString: restoredTarget.toString() }); await restored.connect();
    try { assert.equal(await fingerprint(restored), baselineFingerprint, 'recoverable checkpoint restores all old rows'); }
    finally { await restored.end(); }
    console.info(JSON.stringify({ check: 'isolated_migration_recovery', legacyRowsPreserved: true, restoreFingerprintMatched: true, backupPath }));
  } finally { await db.end(); }
});
