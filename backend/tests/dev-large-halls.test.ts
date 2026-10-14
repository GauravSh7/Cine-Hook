import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import { largeHallLayout, largeHallStarts } from '../prisma/dev-large-halls-core.js';

test('physical layout has unique coordinates and 72 regular, 48 premium, 24 recliner seats', () => {
  const seats = largeHallLayout();
  assert.equal(seats.length, 144);
  assert.equal(new Set(seats.map(s => `${s.rowName}:${s.seatNumber}`)).size, 144);
  assert.deepEqual(['REGULAR', 'PREMIUM', 'RECLINER'].map(type => seats.filter(s => s.seatType === type).length), [72,48,24]);
  assert.deepEqual(seats[143], { rowName: 'L', seatNumber: 12, seatType: 'RECLINER' });
});
test('four future IST days have 18:00 and 22:00 slots even across UTC date boundary', () => {
  const starts = largeHallStarts(new Date('2026-10-14T20:00:00Z'));
  assert.equal(starts.length, 8);
  assert.equal(starts[0]!.toISOString(), '2026-10-16T12:30:00.000Z');
  assert.equal(starts[7]!.toISOString(), '2026-10-19T16:30:00.000Z');
});
