import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedDevelopment } from '../prisma/dev-seed-core.js';
import { DEV_ADMIN, FILMS, seedId } from '../prisma/dev-seed-manifest.js';

const url = process.env.SEED_TEST_DATABASE_URL;
const testPassword = 'IsolatedSeedTest1!';

test('isolated PostgreSQL development seed preserves data, serializes reruns, appends dates and rolls back collisions', { skip: !url, timeout: 120000 }, async () => {
  const target = new URL(url!);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.match(target.pathname, /^\/[A-Za-z0-9_]+_test$/);
  assert.equal(target.search, ''); assert.equal(target.hash, '');
  const database = target.pathname.slice(1), port = Number(target.port || '5432');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: '-c timezone=UTC', connectionTimeoutMillis: 2000 }) });
  const options = { expectedDatabase: database, expectedPort: port, now: new Date('2099-10-08T10:00:00Z'), password: testPassword };
  const snapshot = async () => ({
    users: await prisma.user.findMany({ orderBy: { id: 'asc' } }), movies: await prisma.movie.findMany({ orderBy: { id: 'asc' } }),
    cities: await prisma.city.findMany({ orderBy: { id: 'asc' } }), theatres: await prisma.theatre.findMany({ orderBy: { id: 'asc' } }),
    screens: await prisma.screen.findMany({ orderBy: { id: 'asc' } }), seats: await prisma.seat.findMany({ orderBy: { id: 'asc' } }),
    shows: await prisma.show.findMany({ orderBy: { id: 'asc' }, include: { prices: { orderBy: { seatType: 'asc' } } } }),
    bookings: await prisma.booking.findMany({ orderBy: { id: 'asc' } }),
  });
  // Dedicated suite database only. Never delete, truncate, reset or clean user records.
  // A fresh database is required; leave the resulting fixtures for root inspection.
  try {
    assert.equal(await prisma.user.count(), 0, 'Provide a freshly migrated isolated seed *_test database.');
    assert.equal(await prisma.movie.count(), 0);
    const unrelatedUser = await prisma.user.create({ data: { id: randomUUID(), email: 'unrelated@seed-test.invalid', name: 'Keep user', passwordHash: 'isolated-test-unusable', role: 'USER' } });
    const unrelatedMovie = await prisma.movie.create({ data: { title: 'Keep unrelated movie', description: 'Keep', durationMinutes: 75, releaseDate: new Date('2000-01-01T00:00:00Z'), language: 'english', genres: ['drama'] } });
    // Natural-key film reuse must preserve metadata and derive endsAt from actual duration.
    const reusedFilm = await prisma.movie.create({ data: { title: FILMS[0]!.title, language: FILMS[0]!.language, releaseDate: new Date(`${FILMS[0]!.releaseDate}T00:00:00Z`), description: 'Custom description kept', posterUrl: 'https://example.invalid/custom.jpg', durationMinutes: 129, genres: ['custom'] } });
    const first = await seedDevelopment(prisma, options);
    assert.equal(first.created.shows, 84); assert.equal(first.created.seats, 288); assert.equal(first.created.movies, 29);
    const initial = await snapshot();
    assert.equal(initial.cities.length, 3); assert.equal(initial.theatres.length, 3); assert.equal(initial.screens.length, 6);
    assert.equal(initial.shows.length, 84); assert.equal(initial.shows.flatMap(s => s.prices).length, 252);
    assert.deepEqual(await prisma.user.findUnique({ where: { id: unrelatedUser.id } }), unrelatedUser);
    assert.deepEqual(await prisma.movie.findUnique({ where: { id: unrelatedMovie.id } }), unrelatedMovie);
    assert.deepEqual(await prisma.movie.findUnique({ where: { id: reusedFilm.id } }), reusedFilm);
    const reusedShow = initial.shows.find(s => s.movieId === reusedFilm.id)!;
    assert.equal(reusedShow.endsAt.getTime() - reusedShow.startsAt.getTime(), 129 * 60000);
    assert.match(initial.users.find(u => u.id === DEV_ADMIN.id)!.passwordHash!, /^\$2[ab]\$12\$/);
    assert.equal((await seedDevelopment(prisma, { ...options, password: undefined })).created.shows, 0);
    assert.deepEqual(await snapshot(), initial);
    await Promise.all([seedDevelopment(prisma, options), seedDevelopment(prisma, options)]);
    assert.deepEqual(await snapshot(), initial);
    const concurrentAppend = await Promise.all([
      seedDevelopment(prisma, { ...options, now: new Date('2099-10-09T10:00:00Z') }),
      seedDevelopment(prisma, { ...options, now: new Date('2099-10-09T10:00:00Z') }),
    ]);
    assert.equal(concurrentAppend.reduce((sum, result) => sum + result.created.shows, 0), 12);
    assert.equal(await prisma.show.count(), 96);
    const afterAppend = await snapshot();
    const bookShow = afterAppend.shows[0]!;
    const seat = await prisma.seat.findFirstOrThrow({ where: { screenId: bookShow.screenId, seatType: 'REGULAR' } });
    await prisma.$transaction(async tx => {
      await tx.booking.create({ data: { userId: unrelatedUser.id, showId: bookShow.id, totalPaise: 25000n, expiresAt: new Date('2099-10-09T00:00:00Z'), seats: { create: { seatId: seat.id, price: 25000 } } } });
    });
    const postBooking = await snapshot();
    await seedDevelopment(prisma, { ...options, password: 'DifferentStrong1!' });
    assert.deepEqual(await snapshot(), postBooking, 'Rerun must preserve booking, layout, show and admin password/name.');

    // USER email collision must never promote or overwrite an account.
    await prisma.user.update({ where: { id: DEV_ADMIN.id }, data: { role: 'USER' } });
    const userCollision = await snapshot();
    await assert.rejects(seedDevelopment(prisma, { ...options, now: new Date('2099-10-10T10:00:00Z') }), /admin.*identity|admin.*collision/i);
    assert.deepEqual(await snapshot(), userCollision);
    await prisma.user.update({ where: { id: DEV_ADMIN.id }, data: { role: 'ADMIN' } });

    // Reserved ID collision after earlier transactional operations must rollback all additions.
    // Same-table film namespace collision is observable even when natural key resolves elsewhere.
    await prisma.movie.create({ data: { id: seedId(`movie:${FILMS[0]!.key}`), title: 'Wrong reserved identity', description: 'Collision', durationMinutes: 60, releaseDate: new Date('2000-01-01Z'), language: 'english', genres: ['drama'] } });
    const idCollision = await snapshot();
    await assert.rejects(seedDevelopment(prisma, { ...options, now: new Date('2099-10-10T10:00:00Z') }), /movie.*identity|movie.*collision/i);
    assert.deepEqual(await snapshot(), idCollision);
  } finally { await prisma.$disconnect(); }
});

test('isolated PostgreSQL seed rolls back incompatible existing layout without inserting seats', { skip: !process.env.SEED_LAYOUT_TEST_DATABASE_URL, timeout: 60000 }, async () => {
  const layoutUrl = process.env.SEED_LAYOUT_TEST_DATABASE_URL!;
  const target = new URL(layoutUrl);
  assert.match(target.pathname, /^\/[A-Za-z0-9_]+_test$/);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname));
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol)); assert.equal(target.search, ''); assert.equal(target.hash, '');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: layoutUrl, options: '-c timezone=UTC' }) });
  try {
    assert.equal(await prisma.city.count(), 0, 'Provide a fresh isolated layout *_test database.');
    await prisma.$transaction(async tx => {
      const city = await tx.city.create({ data: { name: 'New Delhi', state: 'Delhi', countryCode: 'IN' } });
      const theatre = await tx.theatre.create({ data: { cityId: city.id, name: 'CineHook Demo Delhi', address: 'Keep custom address' } });
      const screen = await tx.screen.create({ data: { theatreId: theatre.id, name: 'Demo Screen 1', capacity: 1 } });
      await tx.seat.create({ data: { screenId: screen.id, rowName: 'Z', seatNumber: 1, seatType: 'REGULAR' } });
    });
    await assert.rejects(seedDevelopment(prisma, { expectedDatabase: target.pathname.slice(1), expectedPort: Number(target.port || '5432'), now: new Date('2099-10-08T10:00:00Z'), password: testPassword }), /layout/i);
    assert.equal(await prisma.seat.count(), 1); assert.equal(await prisma.movie.count(), 0); assert.equal(await prisma.user.count(), 0); assert.equal(await prisma.show.count(), 0);
    assert.equal((await prisma.theatre.findFirstOrThrow()).address, 'Keep custom address');
  } finally { await prisma.$disconnect(); }
});
