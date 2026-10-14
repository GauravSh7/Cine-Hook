import { describe, expect, it } from 'vitest';
import { assertEventLayout, seedEvents } from '../prisma/event-seed-core.js';
import { EVENT_SAMPLES, eventSeedId, eventStarts } from '../prisma/event-seed-manifest.js';
import * as manifest from '../prisma/event-seed-manifest.js';
import { resolveDevTarget } from '../scripts/dev-target.js';

describe('explicit event seed boundaries', () => {
  it.each(['production', 'test'])('refuses the development command in %s before connecting', NODE_ENV => {
    expect(() => resolveDevTarget({ NODE_ENV, DATABASE_URL: 'postgresql://local@127.0.0.1:5432/cinehook' })).toThrow(/development/);
  });
  it.each([
    ['cinehook', 5432], ['cinehook_dev', 55438], ['seed_test', 5432], ['seed_test', 55439],
  ])('rejects unsafe core target %s:%s before transaction', async (expectedDatabase, expectedPort) => {
    await expect(seedEvents({ $transaction: () => { throw new Error('unexpected transaction'); } } as never,
      { expectedDatabase, expectedPort })).rejects.toThrow(/target/);
  });
  it.each([
    { database: 'cinehook' }, { schema: 'private' }, { port: 5432 }, { address: '192.0.2.1' }, { role: 'another_role' },
  ])('verifies live identity before any lock or data access: %o', async mismatch => {
    const tx = { $queryRaw: async () => [{ database: 'cinehook_event_seed_unit_test', schema: 'public', port: 55438, address: '127.0.0.1', role: 'cinehook_verify', ...mismatch }],
      $executeRaw: () => { throw new Error('unexpected mutation'); } };
    await expect(seedEvents({ $transaction: (work: (client: unknown) => unknown) => work(tx) } as never,
      { expectedDatabase: 'cinehook_event_seed_unit_test', expectedPort: 55438 })).rejects.toThrow(/identity/);
  });
  it('uses absolute next IST dates so rolling additions retain shared session identity', () => {
    const starts = eventStarts(new Date('2026-10-10T20:00:00Z'));
    expect(starts[0]!.toISOString()).toBe('2026-10-12T07:30:00.000Z');
    expect(starts).toHaveLength(7);
    const next = eventStarts(new Date('2026-10-11T20:00:00Z'));
    expect(next.slice(0, 6)).toEqual(starts.slice(1));
    expect(eventSeedId('session:a:2026-10-12T13:00:00.000Z')).not.toBe(eventSeedId('session:a:2026-10-13T13:00:00.000Z'));
    expect(() => eventStarts(new Date(NaN))).toThrow(/clock/);
  });
  it('keeps the original v1 date identity for canonical 13:00 IST session instants', () => {
    expect(typeof manifest.eventSessionSeedId).toBe('function');
    expect(manifest.eventSessionSeedId('delhi-comedy', new Date('2026-10-12T07:30:00Z')))
      .toBe('60ff5dae-308f-5247-a02f-eb562c03a4ce'); // Exact original v1 ID from the pre-fix namespace.
    expect(manifest.eventSessionSeedId('delhi-comedy', new Date('2026-10-13T07:30:00Z')))
      .not.toBe(eventSeedId('session:delhi-comedy:2026-10-12T13:00:00.000Z'));
    expect(() => manifest.eventSessionSeedId('delhi-comedy', new Date(NaN))).toThrow(/clock/);
  });
  it('accepts reordered complete numbered layouts and rejects partial, foreign and re-tiered seats', () => {
    const sample = EVENT_SAMPLES[0]!;
    const layout = sample.sections.map(section => ({ ...section, id: eventSeedId(`section:${sample.key}:${section.code}`),
      seats: section.seats.map(seat => ({ ...seat, id: eventSeedId(`seat:${sample.key}:${section.code}:${seat.rowName}:${seat.seatNumber}`) })) }));
    expect(() => assertEventLayout(sample, sample.capacity, [...layout].reverse())).not.toThrow();
    expect(() => assertEventLayout(sample, sample.capacity - 1, layout)).toThrow(/layout/);
    expect(() => assertEventLayout(sample, sample.capacity, layout.slice(1))).toThrow(/layout/);
    const changed = structuredClone(layout); changed[0]!.seats[0]!.ticketTier = 'STANDARD';
    expect(() => assertEventLayout(sample, sample.capacity, changed)).toThrow(/layout/);
    const foreign = structuredClone(layout); foreign[0]!.seats[0]!.id = eventSeedId('foreign');
    expect(() => assertEventLayout(sample, sample.capacity, foreign)).toThrow(/layout/);
  });
});
