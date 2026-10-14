import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { AppError } from '../../src/errors/app-error.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { HealthService } from '../../src/modules/health/health.service.js';
import { BookingService } from '../../src/modules/booking/booking.service.js';
import type { BookingRecord, BookingStore } from '../../src/modules/booking/booking.types.js';
import type { SeatLocks } from '../../src/modules/seat-lock/seat-lock.types.js';
import { testCatalog } from './catalog.js';
import { testShows } from './shows.js';

export const bookingSecret = 'booking-test-only-key-12345678901234567890';
// Test-only database/Redis I/O substitutes. Domain policy executes in the real
// BookingService. Real Redis and PostgreSQL invariants have separate integration tests.
export async function bookingFixture() {
  const userId = randomUUID(), otherUserId = randomUUID();
  const users = new Map([userId, otherUserId].map(id => [id, { id, name: 'Booking user', email: `${id}@example.com`, role: 'USER' as const, createdAt: new Date(), updatedAt: new Date() }]));
  const tokens = new TokenService({ secret: bookingSecret, expiresInSeconds: 3600 });
  const auth = new AuthService({ create: async () => { throw new Error('unused'); }, findByEmail: async () => null, findById: async id => users.get(id) ?? null }, tokens);
  const catalog = testCatalog(); const shows = testShows(catalog);
  const city = await catalog.services.cities.create({ name: 'Booking city', state: 'State', countryCode: 'IN' });
  const theatre = await catalog.services.theatres.create({ name: 'Booking theatre', address: 'Road', cityId: city.id });
  const screen = await catalog.services.screens.create({ name: 'Booking screen', capacity: 2, theatreId: theatre.id });
  const movie = await catalog.services.movies.create({ title: 'Booking movie', description: 'Test', durationMinutes: 100, releaseDate: new Date('2026-01-01'), language: 'english', genres: ['drama'], posterUrl: null });
  const seats = await shows.services.seats.initialize(screen.id, [{ rowName: 'A', seatNumber: 1, seatType: 'REGULAR' }, { rowName: 'A', seatNumber: 2, seatType: 'PREMIUM' }]);
  const show = await shows.services.shows.create({ movieId: movie.id, screenId: screen.id, startsAt: new Date('2099-01-01T10:00:00Z'), prices: [{ seatType: 'REGULAR', pricePaise: 10000 }, { seatType: 'PREMIUM', pricePaise: 15000 }] });
  const records = new Map<string, BookingRecord>();
  const allocations = new Map<string, string>();
  const holds = new Map<string, { userId: string; holdId: string; expiresAt: number }>();
  const state = { now: new Date('2030-01-01T00:00:00Z'), failDatabase: false, redisDown: false, acquires: 0, releases: 0 };
  const seatKey = (showId: string, seatId: string) => `${showId}:${seatId}`;
  const redisCheck = () => { if (state.redisDown) throw new AppError(503, 'SEAT_LOCK_UNAVAILABLE', 'Seat locking is temporarily unavailable.'); };
  const live = (key: string) => { const value = holds.get(key); return value && value.expiresAt > state.now.getTime() ? value : undefined; };
  const locks: SeatLocks = {
    acquire: async (showId, ids, owner, holdId) => {
      redisCheck(); state.acquires++;
      if (ids.some(id => live(seatKey(showId, id)))) throw new AppError(409, 'SEAT_LOCKED', 'Seats already held.');
      const expiresAt = state.now.getTime() + 300000;
      for (const id of ids) holds.set(seatKey(showId, id), { userId: owner, holdId, expiresAt });
      return { expiresAt: new Date(expiresAt) };
    },
    release: async (showId, ids, owner, holdId) => {
      redisCheck(); state.releases++; let released = 0;
      for (const id of ids) { const key = seatKey(showId, id), hold = live(key); if (hold?.userId === owner && hold.holdId === holdId) { holds.delete(key); released++; } }
      return released;
    },
    validate: async (showId, ids, owner, holdId) => {
      redisCheck(); return ids.length > 0 && ids.every(id => { const hold = live(seatKey(showId, id)); return hold?.userId === owner && hold.holdId === holdId; });
    },
    inspect: async (showId, ids) => {
      redisCheck(); return new Map(ids.map(id => { const hold = live(seatKey(showId, id)); return [id, { locked: Boolean(hold), remainingMs: hold ? hold.expiresAt - state.now.getTime() : 0 }]; }));
    },
  };
  const context: BookingStore['context'] = async (showId, ids) => ({
    show: shows.shows.has(showId) ? await shows.services.shows.getById(showId).catch(() => null) : null,
    seats: [...shows.seats.values()].filter(seat => seat.screenId === shows.shows.get(showId)?.screenId && (!ids || ids.includes(seat.id))),
    allocatedSeatIds: [...allocations].filter(([key]) => key.startsWith(`${showId}:`)).map(([key]) => key.slice(showId.length + 1)).filter(id => !ids || ids.includes(id)),
    now: new Date(state.now),
  });
  const store: BookingStore = {
    context,
    createPending: async (input, prepare) => {
      const prepared = await prepare(await context(input.showId, input.seatIds));
      if (state.failDatabase) throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Booking is temporarily unavailable.');
      const record: BookingRecord = { id: input.id, userId: input.userId, showId: input.showId, status: 'PENDING', totalPaise: prepared.totalPaise,
        expiresAt: input.expiresAt, confirmedAt: null, failureCode: null, createdAt: new Date(state.now), updatedAt: new Date(state.now),
        seats: prepared.seats.map(value => ({ id: randomUUID(), bookingId: input.id, showId: input.showId, seatId: value.seatId, price: value.price, seat: shows.seats.get(value.seatId)! })) };
      records.set(record.id, record); return record;
    },
    transition: async (id, decide) => {
      const current = records.get(id); if (!current) return null;
      const decision = await decide({ ...await context(current.showId, current.seats.map(seat => seat.seatId)), booking: current });
      if (decision.status === 'CONFIRMED') {
        if (current.seats.some(seat => allocations.has(seatKey(current.showId, seat.seatId)))) throw new AppError(409, 'SEAT_ALREADY_BOOKED', 'Seat already booked.');
        for (const seat of current.seats) allocations.set(seatKey(current.showId, seat.seatId), id);
      }
      if (decision.status === 'CANCELLED') {
        for (const seat of current.seats) if (allocations.get(seatKey(current.showId, seat.seatId)) === id) allocations.delete(seatKey(current.showId, seat.seatId));
      }
      const updated = { ...current, ...(decision.status ? { status: decision.status } : {}), ...(decision.failureCode ? { failureCode: decision.failureCode } : {}),
        confirmedAt: decision.status === 'CONFIRMED' ? new Date(state.now) : current.confirmedAt, updatedAt: new Date(state.now) };
      records.set(id, updated); return updated;
    },
    findById: async id => records.get(id) ?? null,
    listByUser: async (owner, page) => [...records.values()].filter(record => record.userId === owner)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)).slice((page.page - 1) * page.limit, page.page * page.limit),
    failPending: async (id, failureCode) => {
      const record = records.get(id); if (!record) return null;
      const next = record.status === 'PENDING' ? { ...record, status: 'FAILED' as const, failureCode, updatedAt: new Date(state.now) } : record;
      records.set(id, next); return next;
    },
    expirePendingForUser: async owner => { for (const [id, record] of records) if (record.userId === owner && record.status === 'PENDING' && record.expiresAt <= state.now) records.set(id, { ...record, status: 'FAILED', failureCode: 'HOLD_EXPIRED' }); },
  };
  const service = new BookingService(store, locks);
  const app = createApp({ frontendOrigin: 'http://localhost:5173', catalog: catalog.services, shows: shows.services, booking: { bookings: service },
    auth: { service: auth, tokens }, healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }) });
  return { app, service, store, locks, records, allocations, holds, state, users, userId, otherUserId, tokens, catalog, shows, show, screen, movie, seats,
    token: tokens.sign({ userId, role: 'USER' }), otherToken: tokens.sign({ userId: otherUserId, role: 'USER' }) };
}
