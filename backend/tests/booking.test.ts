import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { bookingFixture, bookingSecret } from './helpers/booking.js';

type Fixture = Awaited<ReturnType<typeof bookingFixture>>;
const create = (f: Fixture, ids = f.seats.map(seat => seat.id), token = f.token) => request(f.app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send({ showId: f.show.id, seatIds: ids });
const get = (f: Fixture, id: string, token = f.token) => request(f.app).get(`/api/bookings/${id}`).set('Authorization', `Bearer ${token}`);
const release = (f: Fixture, id: string, token = f.token) => request(f.app).delete(`/api/bookings/${id}/hold`).set('Authorization', `Bearer ${token}`);

describe('booking HTTP and real service policy', () => {
  it('creates an authenticated PENDING booking with server-priced seat snapshots', async () => {
    const f = await bookingFixture(); const response = await create(f);
    expect(response.status).toBe(201);
    expect(response.body.data.booking).toMatchObject({ status: 'PENDING', totalPaise: 25000, expiresAt: '2030-01-01T00:05:00.000Z' });
    expect(response.body.data.booking.seats).toEqual(expect.arrayContaining([
      expect.objectContaining({ seatId: f.seats[0]!.id, rowName: 'A', seatNumber: 1, seatType: 'REGULAR', pricePaise: 10000 }),
      expect.objectContaining({ seatId: f.seats[1]!.id, rowName: 'A', seatNumber: 2, seatType: 'PREMIUM', pricePaise: 15000 }),
    ]));
    expect(response.body.data.booking).not.toHaveProperty('holdId'); expect(response.body.data.booking).not.toHaveProperty('owner');
    expect((await get(f, response.body.data.booking.id)).status).toBe(200);
    const list = await request(f.app).get('/api/bookings?page=1&limit=1').set('Authorization', `Bearer ${f.token}`);
    expect(list.status).toBe(200); expect(list.body.data).toMatchObject({ page: 1, limit: 1 });
    expect(list.body.data.items.map((book: { id: string }) => book.id)).toEqual([response.body.data.booking.id]);
  });
  it('prices at creation and keeps snapshots after show prices change', async () => {
    const f = await bookingFixture(); f.shows.shows.get(f.show.id)!.prices[0]!.pricePaise = 12000;
    const response = await create(f); expect(response.status).toBe(201); expect(response.body.data.booking.totalPaise).toBe(27000);
    f.shows.shows.get(f.show.id)!.prices[0]!.pricePaise = 99000;
    expect((await get(f, response.body.data.booking.id)).body.data.booking.totalPaise).toBe(27000);
    await f.service.confirm(response.body.data.booking.id);
    expect((await get(f, response.body.data.booking.id)).body.data.booking.totalPaise).toBe(27000);
  });
  it('totals integer paise without a 32 bit overflow', async () => {
    const f = await bookingFixture();
    for (const price of f.shows.shows.get(f.show.id)!.prices) price.pricePaise = 2147483647;
    const response = await create(f); expect(response.status).toBe(201);
    expect(response.body.data.booking.totalPaise).toBe(4294967294);
    expect(f.records.get(response.body.data.booking.id)!.totalPaise).toBe(4294967294n);
  });
  it('hides cross-user booking reads and releases', async () => {
    const f = await bookingFixture(); const response = await create(f); const id = response.body.data.booking.id;
    expect((await get(f, id, f.otherToken)).status).toBe(404); expect((await release(f, id, f.otherToken)).status).toBe(404);
    expect((await request(f.app).get('/api/bookings').set('Authorization', `Bearer ${f.otherToken}`)).body.data.items).toEqual([]);
    expect(f.records.get(id)!.status).toBe('PENDING');
  });
  it('shows held seats dynamically while static show seats stay unchanged', async () => {
    const f = await bookingFixture(); const before = await request(f.app).get(`/api/shows/${f.show.id}/seats`);
    expect((await create(f, [f.seats[0]!.id])).status).toBe(201);
    const response = await request(f.app).get(`/api/shows/${f.show.id}/availability`);
    expect(response.status).toBe(200); expect(response.body.data.showId).toBe(f.show.id);
    expect(response.body.data.seats).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: f.seats[0]!.id, availability: 'LOCKED', remainingHoldMs: 300000, pricePaise: 10000 }),
      expect.objectContaining({ id: f.seats[1]!.id, availability: 'AVAILABLE', remainingHoldMs: 0 }),
    ]));
    for (const seat of response.body.data.seats) { expect(seat).not.toHaveProperty('owner'); expect(seat).not.toHaveProperty('holdId'); expect(seat).not.toHaveProperty('userId'); }
    expect((await request(f.app).get(`/api/shows/${f.show.id}/seats`)).body).toEqual(before.body);
  });
  it('reports BOOKED when confirmation commits between the initial database read and Redis inspection', async () => {
    const f = await bookingFixture(); const created = await create(f); const id = created.body.data.booking.id;
    const inspect = f.locks.inspect;
    f.locks.inspect = async (showId, ids) => { await f.service.confirm(id); return inspect(showId, ids); };
    const response = await request(f.app).get(`/api/shows/${f.show.id}/availability`);
    expect(response.status).toBe(200);
    expect(response.body.data.seats.map((seat: { availability: string }) => seat.availability)).toEqual(['BOOKED', 'BOOKED']);
    expect(response.body.data.seats.map((seat: { remainingHoldMs: number }) => seat.remainingHoldMs)).toEqual([0, 0]);
  });
  it('cancels a pending hold and makes seats available', async () => {
    const f = await bookingFixture(); const created = await create(f); const id = created.body.data.booking.id;
    const response = await release(f, id); expect(response.status).toBe(200);
    expect(response.body.data.booking).toMatchObject({ status: 'CANCELLED', failureCode: 'CHECKOUT_CANCELLED' });
    expect([...f.holds]).toEqual([]); expect((await create(f)).status).toBe(201);
  });
  it('confirms internally, allocates seats, is idempotent after expiry and rejects confirmed release', async () => {
    const f = await bookingFixture(); const created = await create(f); const id = created.body.data.booking.id;
    await f.service.confirm(id); expect((await get(f, id)).body.data.booking.status).toBe('CONFIRMED'); expect(f.allocations.size).toBe(2);
    expect((await release(f, id)).status).toBe(409); expect(f.allocations.size).toBe(2);
    const availability = await request(f.app).get(`/api/shows/${f.show.id}/availability`);
    expect(availability.body.data.seats.every((seat: { availability: string }) => seat.availability === 'BOOKED')).toBe(true);
    expect((await request(f.app).post(`/api/bookings/${id}/confirm`).set('Authorization', `Bearer ${f.token}`).send({})).status).toBe(404);
    f.state.now = new Date('2030-01-01T00:06:00Z'); await f.service.confirm(id); expect(f.allocations.size).toBe(2);
    expect((await get(f, id)).body.data.booking.status).toBe('CONFIRMED');
  });
  it('fails an expired hold without releasing a replacement by the same user', async () => {
    const f = await bookingFixture(); const old = await create(f); const oldId = old.body.data.booking.id;
    f.state.now = new Date('2030-01-01T00:05:00Z');
    const replacement = await create(f); expect(replacement.status).toBe(201); const replacementId = replacement.body.data.booking.id;
    await expect(f.service.confirm(oldId)).rejects.toMatchObject({ status: 409, code: 'HOLD_EXPIRED' });
    expect((await get(f, oldId)).body.data.booking.status).toBe('FAILED');
    expect(await f.locks.validate(f.show.id, f.seats.map(seat => seat.id), f.userId, replacementId)).toBe(true);
    expect((await get(f, replacementId)).body.data.booking.status).toBe('PENDING');
  });
  it('fails a lost hold without allocating or reacquiring seats', async () => {
    const f = await bookingFixture(); const created = await create(f); const id = created.body.data.booking.id;
    f.holds.clear(); await expect(f.service.confirm(id)).rejects.toMatchObject({ status: 409, code: 'HOLD_LOST' });
    expect((await get(f, id)).body.data.booking.status).toBe('FAILED'); expect(f.allocations.size).toBe(0); expect(f.state.acquires).toBe(1);
  });
  it('does not renew or retry an occupied hold', async () => {
    const f = await bookingFixture(); expect((await create(f)).status).toBe(201); f.state.now = new Date('2030-01-01T00:01:00Z');
    expect((await create(f)).status).toBe(409); expect(f.state.acquires).toBe(2); expect(f.records.size).toBe(1);
    expect([...await f.locks.inspect(f.show.id, f.seats.map(seat => seat.id))].map(([, state]) => state.remainingMs)).toEqual([240000, 240000]);
  });
  it('compensates a failed database save by releasing the newly acquired hold', async () => {
    const f = await bookingFixture(); f.state.failDatabase = true;
    expect((await create(f)).status).toBe(503); expect(f.records.size).toBe(0); expect(f.holds.size).toBe(0); expect(f.state.releases).toBe(1);
    f.state.failDatabase = false; expect((await create(f)).status).toBe(201);
  });
  it('marks an ambiguously committed create FAILED before releasing its hold or allowing trusted confirmation', async () => {
    const f = await bookingFixture(); const createPending = f.store.createPending;
    f.store.createPending = async (input, prepare) => { await createPending(input, prepare); throw new Error('Injected lost commit acknowledgement'); };
    const releaseHold = f.locks.release; let attemptedConfirm = false;
    f.locks.release = async (showId, ids, userId, holdId) => {
      if (!attemptedConfirm) { attemptedConfirm = true; try { await f.service.confirm(holdId); } catch {} }
      return releaseHold(showId, ids, userId, holdId);
    };
    await expect(f.service.create(f.userId, { showId: f.show.id, seatIds: f.seats.map(seat => seat.id) })).rejects.toThrow('Injected lost commit acknowledgement');
    expect(attemptedConfirm).toBe(true); expect(f.records.size).toBe(1);
    expect([...f.records.values()][0]!.status).toBe('FAILED'); expect(f.allocations.size).toBe(0);
  });
  it('fails closed on Redis outages during create and availability', async () => {
    const f = await bookingFixture(); f.state.redisDown = true;
    for (const response of [await create(f), await request(f.app).get(`/api/shows/${f.show.id}/availability`)]) {
      expect(response.status).toBe(503); expect(response.body.error.code).toBe('SEAT_LOCK_UNAVAILABLE');
      expect(Object.keys(response.body.error).sort()).toEqual(['code', 'message', 'requestId']);
      expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    }
    expect(f.records.size).toBe(0);
  });
  it('allows booking the other seat after one seat is confirmed', async () => {
    const f = await bookingFixture(); const first = await create(f, [f.seats[0]!.id]);
    await f.service.confirm(first.body.data.booking.id);
    expect((await create(f, [f.seats[1]!.id])).status).toBe(201);
    expect((await create(f, [f.seats[0]!.id])).status).toBe(409);
  });
  it('recovers an allocation conflict as FAILED with no partial allocation or foreign deletion', async () => {
    const f = await bookingFixture(); const created = await create(f); const id = created.body.data.booking.id;
    const foreignBookingId = randomUUID(); f.allocations.set(`${f.show.id}:${f.seats[0]!.id}`, foreignBookingId);
    await expect(f.service.confirm(id)).rejects.toMatchObject({ status: 409 });
    expect(f.records.get(id)!.status).toBe('FAILED'); expect(f.allocations.size).toBe(1);
    expect(f.allocations.get(`${f.show.id}:${f.seats[0]!.id}`)).toBe(foreignBookingId);
    expect(f.holds.size).toBe(0);
  });
  it('lists only owner bookings with stable pagination and sweeps expiry', async () => {
    const f = await bookingFixture(); const first = await create(f, [f.seats[0]!.id]);
    f.state.now = new Date('2030-01-01T00:00:01Z'); const second = await create(f, [f.seats[1]!.id]);
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    const page = await request(f.app).get('/api/bookings?page=2&limit=1').set('Authorization', `Bearer ${f.token}`);
    expect(page.body.data.items.map((booking: { id: string }) => booking.id)).toEqual([first.body.data.booking.id]);
    f.state.now = new Date('2030-01-01T00:05:01Z');
    const expired = await request(f.app).get('/api/bookings').set('Authorization', `Bearer ${f.token}`);
    expect(expired.body.data.items).toHaveLength(2);
    expect(expired.body.data.items.every((booking: { status: string; failureCode: string }) => booking.status === 'FAILED' && booking.failureCode === 'HOLD_EXPIRED')).toBe(true);
  });
  it('rejects already started shows with409 and unknown bookings with404', async () => {
    const f = await bookingFixture(); f.shows.shows.get(f.show.id)!.startsAt = new Date('2029-12-31T00:00:00Z');
    expect((await create(f)).status).toBe(409);
    expect((await request(f.app).get(`/api/shows/${f.show.id}/availability`)).status).toBe(409);
    expect((await get(f, randomUUID())).status).toBe(404); expect((await release(f, randomUUID())).status).toBe(404);
  });
  it('requires authentication and rejects deleted or expired identities', async () => {
    const f = await bookingFixture(); expect((await request(f.app).post('/api/bookings').send({})).status).toBe(401);
    expect((await request(f.app).get('/api/bookings')).status).toBe(401);
    const expired = jwt.sign({ userId: f.userId, role: 'USER' }, bookingSecret, { expiresIn: -1, issuer: 'cinehook', audience: 'cinehook-api' });
    expect((await create(f, f.seats.map(seat => seat.id), expired)).status).toBe(401); f.users.delete(f.userId); expect((await create(f)).status).toBe(401);
  });
  it.each([{ totalPaise: 1 }, { userId: randomUUID() }, { status: 'CONFIRMED' }, { seatIds: [] },
    { seatIds: Array.from({ length: 11 }, () => randomUUID()) }, { seatIds: ['invalid'] }, { showId: 'invalid' }])('rejects strict or invalid booking input: %j', async override => {
    const f = await bookingFixture(); const response = await request(f.app).post('/api/bookings').set('Authorization', `Bearer ${f.token}`)
      .send({ showId: f.show.id, seatIds: f.seats.map(seat => seat.id), ...override });
    expect(response.status).toBe(400); expect(f.records.size).toBe(0); expect(f.state.acquires).toBe(0);
  });
  it('rejects duplicate seats and seats from another screen', async () => {
    const f = await bookingFixture(); expect((await create(f, [f.seats[0]!.id, f.seats[0]!.id])).status).toBe(400);
    const foreign = { ...f.seats[0]!, id: randomUUID(), screenId: randomUUID() }; f.shows.seats.set(foreign.id, foreign);
    const response = await create(f, [foreign.id]); expect([400, 409]).toContain(response.status); expect(f.state.acquires).toBe(0);
  });
  it('hides disabled and cancelled shows from booking and availability', async () => {
    const f = await bookingFixture(); f.shows.shows.get(f.show.id)!.status = 'CANCELLED';
    expect((await create(f)).status).toBe(404); expect((await request(f.app).get(`/api/shows/${f.show.id}/availability`)).status).toBe(404);
    f.shows.shows.get(f.show.id)!.status = 'SCHEDULED'; f.catalog.movies.get(f.movie.id)!.isActive = false; expect((await create(f)).status).toBe(404);
  });
  it.each(['/api/bookings/not-a-uuid', '/api/bookings?page=0', '/api/bookings?limit=101', '/api/bookings?unknown=x'])('rejects invalid protected reads %s', async path => {
    const f = await bookingFixture(); expect((await request(f.app).get(path).set('Authorization', `Bearer ${f.token}`)).status).toBe(400);
  });
});
