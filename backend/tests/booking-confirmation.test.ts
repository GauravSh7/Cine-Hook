import { expect, it } from 'vitest';
import { bookingFixture } from './helpers/booking.js';

it('transaction-scoped confirmation defers Redis cleanup until the outer commit', async () => {
  const f = await bookingFixture();
  const booking = await f.service.create(f.userId, { showId: f.show.id, seatIds: f.seats.map(seat => seat.id) });
  const cleanup: (() => Promise<void>)[] = [];
  const result = await f.service.confirm(booking.id, { store: f.store, afterCommit: callback => cleanup.push(callback) });
  expect(result.status).toBe('CONFIRMED');
  expect(await f.locks.validate(f.show.id, f.seats.map(seat => seat.id), f.userId, booking.id)).toBe(true);
  for (const callback of cleanup) await callback();
  expect(await f.locks.validate(f.show.id, f.seats.map(seat => seat.id), f.userId, booking.id)).toBe(false);
});

it('transaction-scoped expired confirmation returns failed fulfillment without losing the financial transaction', async () => {
  const f = await bookingFixture();
  const booking = await f.service.create(f.userId, { showId: f.show.id, seatIds: f.seats.map(seat => seat.id) });
  f.state.now = new Date('2030-01-01T00:05:00Z');
  const result = await f.service.confirm(booking.id, { store: f.store, afterCommit: () => {} });
  expect(result.status).toBe('FAILED'); expect(result.failureCode).toBe('HOLD_EXPIRED');
  expect(f.allocations.size).toBe(0); expect(f.state.acquires).toBe(1);
});

it('failed payment fulfillment never demotes an already confirmed booking', async () => {
  const f = await bookingFixture();
  const booking = await f.service.create(f.userId, { showId: f.show.id, seatIds: f.seats.map(seat => seat.id) });
  await f.service.confirm(booking.id);
  const result = await f.service.failUnfulfilled(booking.id, 'FULFILLMENT_CONFLICT', { store: f.store, afterCommit: () => {} });
  expect(result.status).toBe('CONFIRMED'); expect(f.allocations.size).toBe(2);
});

it('order preparation checks show bookability as well as the owned live hold', async () => {
  const f = await bookingFixture();
  const booking = await f.service.create(f.userId, { showId: f.show.id, seatIds: f.seats.map(seat => seat.id) });
  f.shows.shows.get(f.show.id)!.status = 'CANCELLED';
  await expect(f.service.payable(f.userId, booking.id)).rejects.toMatchObject({ status: 409, code: 'SHOW_CLOSED' });
});
