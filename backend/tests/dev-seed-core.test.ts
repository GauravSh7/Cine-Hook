import { describe, expect, it } from 'vitest';
import { assertLayoutCompatible, seedDevelopment } from '../prisma/dev-seed-core.js';
import { SEAT_LAYOUT } from '../prisma/dev-seed-manifest.js';

describe('development seed preservation boundaries', () => {
  it('rejects unknown targets before opening any transaction', async () => {
    let transactions = 0;
    const client = { $transaction: async () => { transactions++; throw new Error('unexpected transaction'); } };
    await expect(seedDevelopment(client as never, { expectedDatabase: 'cinehook', expectedPort: 5432 })).rejects.toThrow(/target/i);
    await expect(seedDevelopment(client as never, { expectedDatabase: 'cinehook_dev', expectedPort: 55438 })).rejects.toThrow(/target/i);
    expect(transactions).toBe(0);
  });
  it('accepts the complete existing layout without depending on row order or IDs', () => {
    expect(() => assertLayoutCompatible(48, [...SEAT_LAYOUT].reverse())).not.toThrow();
  });
  it.each([
    [47, SEAT_LAYOUT],
    [48, SEAT_LAYOUT.slice(1)],
    [48, SEAT_LAYOUT.map((s,i) => i === 0 ? { ...s, seatType: 'PREMIUM' } : s)],
    [48, SEAT_LAYOUT.map((s,i) => i === 0 ? { ...s, seatNumber: 9 } : s)],
    [48, [...SEAT_LAYOUT.slice(1), SEAT_LAYOUT[1]]],
  ])('rejects an incompatible physical layout instead of repairing it', (capacity, seats) => {
    expect(() => assertLayoutCompatible(capacity as number, seats as never)).toThrow(/layout/i);
  });
});
