import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { bookingFixture } from './helpers/booking.js';

it('checkout cancellation persists CANCELLED, releases owned holds and repeats safely', async () => {
  const f = await bookingFixture();
  const b = await f.service.create(f.userId, { showId: f.show.id, seatIds: f.seats.map(s => s.id) });
  await expect(f.service.releaseHold(f.otherUserId, b.id)).rejects.toMatchObject({status:404});
  expect((await f.service.releaseHold(f.userId,b.id)).status).toBe('CANCELLED');
  expect(f.holds.size).toBe(0);
  expect((await f.service.releaseHold(f.userId,b.id)).status).toBe('CANCELLED');
  expect(f.records.get(b.id)!.seats).toHaveLength(2);
  await expect(f.service.confirm(b.id)).rejects.toMatchObject({code:'CHECKOUT_CANCELLED'});
});

async function confirmed() {
  const f = await bookingFixture(); const value = await f.service.create(f.userId, { showId: f.show.id, seatIds: f.seats.map(seat => seat.id) });
  await f.service.confirm(value.id);
  return { ...f, bookingId: value.id, scope: { store: f.store, afterCommit: () => {} } };
}
it('owner cancellation policy preserves quote history and does not contact Redis', async () => {
  const f = await confirmed(); const before = f.records.get(f.bookingId)!; f.state.redisDown = true;
  const result = await f.service.cancel(f.userId, f.bookingId, f.scope);
  expect(result.status).toBe('CANCELLED'); expect(f.records.get(f.bookingId)!.totalPaise).toBe(25000n);
  expect(f.records.get(f.bookingId)!.seats).toEqual(before.seats); expect(f.records.size).toBe(1);
});
it.each([[0, true], [86_399_999, true], [86_400_000, false], [86_400_001, false]] as const)('enforces original-age boundary %d through the service', async (age, allowed) => {
  const f = await confirmed(); const original = f.records.get(f.bookingId)!;
  f.state.now = new Date(original.createdAt.getTime() + age);
  if (allowed) {
    expect((await f.service.cancel(f.userId, f.bookingId, f.scope)).status).toBe('CANCELLED');
    expect(f.allocations.size).toBe(0);
  } else {
    await expect(f.service.cancel(f.userId, f.bookingId, f.scope)).rejects.toMatchObject({ code: 'CANCELLATION_CLOSED' });
    expect(f.records.get(f.bookingId)!.status).toBe('CONFIRMED');
    expect(f.allocations.size).toBe(2);
  }
  expect(f.records.get(f.bookingId)!.createdAt).toEqual(original.createdAt);
  expect(f.records.get(f.bookingId)!.seats).toEqual(original.seats);
});
it('rejects cancellation on the current Kolkata show date even within the original 24-hour window', async () => {
  const f = await confirmed(); const original = f.records.get(f.bookingId)!;
  f.state.now = new Date('2099-01-01T00:00:00+05:30');
  f.records.set(original.id, { ...original, createdAt: new Date(f.state.now.getTime() - 60_000) });
  await expect(f.service.cancel(f.userId, f.bookingId, f.scope)).rejects.toMatchObject({ code: 'CANCELLATION_CLOSED' });
  expect(f.records.get(f.bookingId)!.status).toBe('CONFIRMED');
  expect(f.allocations.size).toBe(2);
});
it.each(['equal', 'after'] as const)('rejects normal cancellation %s to show start', async point => {
  const f = await confirmed(); f.state.now = new Date(point === 'equal' ? f.show.startsAt : f.show.startsAt.getTime() + 1);
  await expect(f.service.cancel(f.userId, f.bookingId, f.scope)).rejects.toMatchObject({ status: 409, code: 'CANCELLATION_CLOSED' });
  expect(f.records.get(f.bookingId)!.status).toBe('CONFIRMED');
});
it('hides foreign bookings and accepts pending checkout cancellation in a transaction scope', async () => {
  const f = await confirmed();
  await expect(f.service.cancel(f.otherUserId, f.bookingId, f.scope)).rejects.toMatchObject({ status: 404 });
  const record = f.records.get(f.bookingId)!; f.records.set(record.id, { ...record, status: 'PENDING' });
  expect((await f.service.cancel(f.userId, f.bookingId, f.scope)).status).toBe('CANCELLED');
});
it('repeated already-cancelled policy requests remain idempotent after the cutoff', async () => {
  const f = await confirmed(); await f.service.cancel(f.userId, f.bookingId, f.scope); f.state.now = new Date(f.show.startsAt);
  expect((await f.service.cancel(f.userId, f.bookingId, f.scope)).status).toBe('CANCELLED');
});
it('availability inspects a previously allocated seat cancelled and re-held during its read', async () => {
  const f = await confirmed(); const inspect = f.locks.inspect;
  f.locks.inspect = async (showId, ids) => {
    f.allocations.clear();
    f.holds.set(`${showId}:${f.seats[0]!.id}`, { userId: f.otherUserId, holdId: randomUUID(), expiresAt: f.state.now.getTime() + 300000 });
    return inspect(showId, ids);
  };
  const value = await f.service.availability(f.show.id);
  expect(value.seats.find(seat => seat.id === f.seats[0]!.id)).toMatchObject({ availability: 'LOCKED', remainingHoldMs: 300000 });
});
