import { describe, expect, it } from 'vitest';
import { resolveStagingTarget, verifyStagingIdentity, parseImportArguments, safeStagingFailureMessage } from '../scripts/staging-target.js';
import { existsSync } from 'node:fs';
import { stagingManifest, inventoryCounts } from '../scripts/staging-manifest.js';
import { inspectCatalogue, applyCatalogue } from '../scripts/staging-catalogue-core.js';

const env = { STAGING_IMPORT_ENV: 'staging', STAGING_DATABASE_URL: 'postgresql://catalogue:placeholder@ep-test.region.aws.neon.tech/neondb?sslmode=verify-full',
  STAGING_EXPECTED_HOST: 'ep-test.region.aws.neon.tech', STAGING_EXPECTED_DATABASE: 'neondb', STAGING_EXPECTED_ROLE: 'catalogue', STAGING_BACKEND_ORIGIN: 'https://cinehook.onrender.com' };

describe('staging target safeguards', () => {
  it('requires a separate explicitly configured target rather than DATABASE_URL fallback', () => {
    expect(() => resolveStagingTarget({ DATABASE_URL: env.STAGING_DATABASE_URL })).toThrow();
    expect(resolveStagingTarget(env).database).toBe('neondb');
  });
  it.each([
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { STAGING_IMPORT_ENV: 'production' }, { STAGING_EXPECTED_DATABASE: 'wrong' }, { STAGING_EXPECTED_HOST: 'wrong.neon.tech' },
    { STAGING_EXPECTED_ROLE: 'wrong' }, { STAGING_DATABASE_URL: 'postgresql://catalogue:p@localhost/neondb?sslmode=verify-full' },
    { STAGING_DATABASE_URL: env.STAGING_DATABASE_URL.replace('verify-full', 'disable') },
    { STAGING_DATABASE_URL: env.STAGING_DATABASE_URL.replace('verify-full', 'require') },
    { STAGING_DATABASE_URL: env.STAGING_DATABASE_URL + '&options=-c%20search_path=private' },
  ])('rejects an unsafe or mismatched target %j', overrides => expect(() => resolveStagingTarget({ ...env, ...overrides })).toThrow());
  it('checks actual database, role, schema and server identity', () => {
    const target = resolveStagingTarget(env);
    expect(() => verifyStagingIdentity(target, { database: 'neondb', role: 'catalogue', schema: 'public', port: 5432 })).not.toThrow();
    for (const overrides of [{ database: 'wrong' }, { role: 'wrong' }, { schema: 'private' }, { port: 5433 }]) {
      expect(() => verifyStagingIdentity(target, { database: 'neondb', role: 'catalogue', schema: 'public', port: 5432, ...overrides })).toThrow();
    }
  });
  it('defaults to dry-run and requires a plan hash plus explicit write approval', () => {
    expect(parseImportArguments([]).mode).toBe('dry-run');
    expect(() => parseImportArguments(['--apply'])).toThrow();
    expect(() => parseImportArguments(['--apply', '--approved-plan', 'a'.repeat(64)])).toThrow();
    expect(parseImportArguments(['--apply', '--approve-write', '--approved-plan', 'a'.repeat(64)]).mode).toBe('apply');
    expect(() => parseImportArguments(['--apply', '--dry-run'])).toThrow();
    expect(() => parseImportArguments(['--start-date'])).toThrow();
  });
  it('never prints arbitrary provider messages, even those resembling importer diagnostics', () => {
    for (const message of ['Staging password=private-secret', 'postgresql://private-secret', 'Backend staging private-secret']) {
      expect(safeStagingFailureMessage(new Error(message))).not.toContain('private-secret');
    }
  });
});

describe('catalogue-only staging manifest', () => {
  const manifest = stagingManifest('2099-10-15');
  it('includes existing movies, tiered physical layouts and fictional experiences without private tables', () => {
    expect(inventoryCounts(manifest)).toMatchObject({ cities: 3, movies: 30, theatres: 3, screens: 6, seats: 576, shows: 126,
      events: 9, eventVenues: 9, eventSections: 30, eventSeats: 612, eventSessions: 63, listings: 24 });
    expect(manifest.map(group => group.model)).not.toContain('user');
    expect(manifest.map(group => group.model)).not.toContain('booking');
    expect(manifest.map(group => group.model)).not.toContain('payment');
    for (const row of manifest.find(g => g.model === 'movie')!.rows) {
      expect(row.posterUrl).toMatch(/^\/demo-art\/.+-poster\.svg$/);
      expect(row.ratingValue).toBeNull();
      expect(existsSync(new URL('../../frontend/public' + row.posterUrl, import.meta.url))).toBe(true);
      expect(existsSync(new URL('../../frontend/public' + row.backdropUrl, import.meta.url))).toBe(true);
    }
  });
  it('creates timezone-aware non-overlapping future slots with immutable per-tier prices', () => {
    const shows = manifest.find(g => g.model === 'show')!.rows;
    const screens = [...new Set(shows.map(row => row.screenId))];
    for (const screen of screens) {
      const slots = shows.filter(row => row.screenId === screen).sort((a, b) => +a.startsAt! - +b.startsAt!);
      for (let i = 1; i < slots.length; i++) expect(+slots[i]!.startsAt!).toBeGreaterThanOrEqual(+slots[i - 1]!.endsAt!);
    }
    expect(manifest.find(g => g.model === 'showSeatPrice')!.rows).toHaveLength(378);
    expect(manifest.find(g => g.model === 'eventSessionPrice')!.rows).toHaveLength(189);
  });
  it('keeps matching future slot IDs stable as the import window rolls forward', () => {
    const next = stagingManifest('2099-10-16').find(g => g.model === 'show')!.rows;
    const previous = new Map(manifest.find(g => g.model === 'show')!.rows.map(row => [row.id, row]));
    for (const row of next.filter(row => previous.has(row.id))) expect(row).toEqual(previous.get(row.id));
  });
});

// A transaction/store fake rejects every mutation except catalogue createMany.
function storeFixture() {
  const records: Record<string, any[]> = {}, writes: string[] = [];
  const tx: any = {};
  for (const group of stagingManifest('2099-10-15')) {
    records[group.model] = [];
    tx[group.model] = {
      findMany: async () => records[group.model],
      createMany: async ({ data }: any) => { writes.push(group.model); records[group.model]!.push(...structuredClone(data)); return { count: data.length }; },
    };
  }
  return { tx, records, writes };
}
describe('idempotent additive import', () => {
  it('dry-run never writes and repeated apply creates zero rows while preserving operator changes', async () => {
    const f = storeFixture(), manifest = stagingManifest('2099-10-15');
    const plan = await inspectCatalogue(f.tx, manifest);
    expect(f.writes).toEqual([]);
    await applyCatalogue(f.tx, plan);
    f.records.movie![0].description = 'Operator description';
    f.records.showSeatPrice![0].pricePaise = 99999;
    const repeated = await inspectCatalogue(f.tx, manifest);
    expect(Object.values(repeated.createCounts).reduce((a, b) => a + b, 0)).toBe(0);
    await applyCatalogue(f.tx, repeated);
    expect(f.records.movie![0].description).toBe('Operator description');
    expect(f.records.showSeatPrice![0].pricePaise).toBe(99999);
  });
  it('rejects a natural-key collision without writing or adopting unrelated inventory', async () => {
    const f = storeFixture(), manifest = stagingManifest('2099-10-15');
    f.records.city = [{ ...manifest.find(g => g.model === 'city')!.rows[0], id: 'unrelated-id' }];
    await expect(inspectCatalogue(f.tx, manifest)).rejects.toThrow(/collision/i);
    expect(f.writes).toEqual([]);
  });
  it('rejects physical layout or capacity changes rather than modifying seats', async () => {
    const f = storeFixture(), manifest = stagingManifest('2099-10-15');
    f.records.screen = [{ ...manifest.find(g => g.model === 'screen')!.rows[0], capacity: 1 }];
    await expect(inspectCatalogue(f.tx, manifest)).rejects.toThrow(/collision/i);
    expect(f.writes).toEqual([]);
  });
  it('rejects seats outside the approved layout without deleting them', async () => {
    const f = storeFixture(), manifest = stagingManifest('2099-10-15');
    f.records.seat = [{ ...manifest.find(g => g.model === 'seat')!.rows[0], id: 'unexpected-seat', rowName: 'Z' }];
    await expect(inspectCatalogue(f.tx, manifest)).rejects.toThrow(/collision/i);
    expect(f.writes).toEqual([]);
  });
});
