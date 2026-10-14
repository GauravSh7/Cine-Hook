import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { DEV_ADMIN, FILMS, VENUES, SEAT_LAYOUT, SEAT_PRICES, futureShowStarts, seedId, validateAdminPassword } from '../prisma/dev-seed-manifest.js';
import { resolveDevTarget, verifyDatabaseIdentity, runDevCommand } from '../scripts/dev-target.js';

describe('development database boundary', () => {
  it('refuses billing-preview on a non-start command before connecting or spawning',()=>{
    const result=spawnSync(process.execPath,['--import','tsx','scripts/dev-launch.ts','check','--billing-preview'],{
      cwd:process.cwd(),env:{...process.env,NODE_ENV:'development',DEV_DATABASE_URL:'postgresql://hidden:never-print-this@remote.example:5432/cinehook_dev'},encoding:'utf8',timeout:5000,
    });
    expect(result.status).toBe(1);expect(result.stderr).toMatch(/billing-preview requires start/);
    expect(result.stderr).not.toContain('never-print-this');
  });
  const original = 'postgresql://local_user:encoded%40password@localhost:5432/cinehook';
  it('derives only the dedicated local database while retaining encoded credentials', () => {
    const target = resolveDevTarget({ DATABASE_URL: original });
    expect(target.database).toBe('cinehook_dev');
    expect(target.url).toBe('postgresql://local_user:encoded%40password@localhost:5432/cinehook_dev');
    expect(target.port).toBe(5432);
  });
  it('prefers the explicit development URL', () => {
    expect(resolveDevTarget({ DATABASE_URL: 'invalid', DEV_DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/cinehook_dev' }).database).toBe('cinehook_dev');
  });
  it.each([
    { NODE_ENV: 'production', DATABASE_URL: original },
    { NODE_ENV: 'test', DATABASE_URL: original },
    { DEV_DATABASE_URL: 'postgresql://u:p@localhost:5432/cinehook' },
    { DEV_DATABASE_URL: 'postgresql://u:p@localhost:5434/cinehook_dev' },
    { DEV_DATABASE_URL: 'postgresql://u:p@remote.example:5432/cinehook_dev' },
    { DEV_DATABASE_URL: 'https://localhost:5432/cinehook_dev' },
    { DEV_DATABASE_URL: 'postgresql://u:p@localhost:5432/cinehook_dev?options=-csearch_path%3Dprivate' },
    { DEV_DATABASE_URL: 'postgresql://u:p@localhost:5432/cinehook_dev#private' },
    { DATABASE_URL: 'postgresql://u:p@localhost:5432/cinehook?host=remote.example' },
    {},
  ])('rejects an unsafe target without exposing a connection URL', env => {
    expect(() => resolveDevTarget(env)).toThrow(/development|database|local/i);
    try { resolveDevTarget(env); } catch (error) { expect(String(error)).not.toContain('u:p@'); }
  });
  it('checks the actual SQL database, schema and service port', async () => {
    const target = resolveDevTarget({ DATABASE_URL: original });
    await expect(verifyDatabaseIdentity({ query: async () => ({ rows: [{ database: 'cinehook_dev', schema: 'public', port: 5432 }] }) }, target)).resolves.toBeUndefined();
    for (const identity of [
      { database: 'cinehook', schema: 'public', port: 5432 },
      { database: 'cinehook_dev', schema: 'private', port: 5432 },
      { database: 'cinehook_dev', schema: 'public', port: 5434 },
    ]) await expect(verifyDatabaseIdentity({ query: async () => ({ rows: [identity] }) }, target)).rejects.toThrow(/identity/i);
  });
  it('rejects production before constructing a database client or spawning a child', async () => {
    let effects = 0;
    await expect(runDevCommand('seed', { NODE_ENV: 'production', DATABASE_URL: original }, {
      connect: async () => { effects++; throw new Error('must not connect'); },
      launch: async () => { effects++; return 0; },
    })).rejects.toThrow(/development/i);
    expect(effects).toBe(0);
  });
  it('does not migrate or launch when server identity differs', async () => {
    let launches = 0, closes = 0;
    await expect(runDevCommand('migrate', { DATABASE_URL: original }, {
      connect: async () => ({ query: async () => ({ rows: [{ database: 'cinehook', schema: 'public', port: 5432 }] }), end: async () => { closes++; } }),
      launch: async () => { launches++; return 0; },
    })).rejects.toThrow(/identity/i);
    expect(launches).toBe(0); expect(closes).toBe(1);
  });
  it('the public launcher fails closed before network access in production', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/dev-launch.ts', 'migrate'], {
      cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production', DEV_DATABASE_URL: 'postgresql://secret:never-print-this@remote.example:5432/cinehook' }, encoding: 'utf8', timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/development command requires NODE_ENV=development/);
    expect(result.stderr).not.toContain('never-print-this');
  });
});

describe('development inventory', () => {
  it('uses tomorrow at 18:30 IST for exactly seven future dates', () => {
    const dates = futureShowStarts(new Date('2026-10-08T10:00:00Z'));
    expect(dates.map(d => d.toISOString())).toEqual([
      '2026-10-09T13:00:00.000Z','2026-10-10T13:00:00.000Z','2026-10-11T13:00:00.000Z',
      '2026-10-12T13:00:00.000Z','2026-10-13T13:00:00.000Z','2026-10-14T13:00:00.000Z','2026-10-15T13:00:00.000Z',
    ]);
    expect(futureShowStarts(new Date('2026-10-08T20:00:00Z'))[0]?.toISOString()).toBe('2026-10-10T13:00:00.000Z');
    expect(() => futureShowStarts(new Date('invalid'))).toThrow();
  });
  it('provides a complete A-F by 1-8 layout with integer paise prices', () => {
    expect(SEAT_LAYOUT).toHaveLength(48);
    expect(new Set(SEAT_LAYOUT.map(s => `${s.rowName}:${s.seatNumber}`)).size).toBe(48);
    expect(SEAT_LAYOUT.filter(s => s.seatType === 'REGULAR')).toHaveLength(32);
    expect(SEAT_LAYOUT.filter(s => s.seatType === 'PREMIUM')).toHaveLength(8);
    expect(SEAT_LAYOUT.filter(s => s.seatType === 'RECLINER')).toHaveLength(8);
    expect(SEAT_PRICES).toEqual([{ seatType: 'REGULAR', pricePaise: 25000 }, { seatType: 'PREMIUM', pricePaise: 40000 }, { seatType: 'RECLINER', pricePaise: 65000 }]);
  });
  it('provides thirty sourced films with real HTTPS poster images where configured', () => {
    expect(FILMS).toHaveLength(30); expect(VENUES).toHaveLength(3);
    expect(new Set(FILMS.map(f => seedId(`movie:${f.key}`))).size).toBe(30);
    for (const film of FILMS) { expect(film.posterUrl).toMatch(/^https:\/\//); expect(film.sourceUrl).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//); expect(film.ratingValue).toBeNull(); }
    expect(VENUES.map(v => [v.name, v.state])).toEqual([['New Delhi','Delhi'],['Mumbai','Maharashtra'],['Bengaluru','Karnataka']]);
    expect(VENUES.every(v => v.theatreName.includes('Demo'))).toBe(true);
    expect(seedId('show:one:2026-10-09')).toBe(seedId('show:one:2026-10-09'));
    expect(seedId('show:one:2026-10-09')).not.toBe(seedId('show:one:2026-10-10'));
    expect(DEV_ADMIN.email).toBe('admin@cinehook.local');
  });
  it('rejects weak passwords, bcrypt truncation and NUL without revealing input', () => {
    expect(() => validateAdminPassword('Short!1')).toThrow(/password/i);
    expect(() => validateAdminPassword('abcdefghijkl')).toThrow(/password/i);
    expect(() => validateAdminPassword('A1!'+ 'é'.repeat(35))).toThrow(/password/i);
    expect(() => validateAdminPassword('ValidPassword1!\0')).toThrow(/password/i);
    expect(() => validateAdminPassword('LocalDevelopment1!')).not.toThrow();
  });
});
