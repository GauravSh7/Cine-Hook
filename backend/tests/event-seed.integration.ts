import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createPrisma } from '../src/lib/prisma.js';
import { seedEvents } from '../prisma/event-seed-core.js';
import { EVENT_SAMPLES, eventSeedId, eventStarts } from '../prisma/event-seed-manifest.js';

const url = process.env.EVENT_SEED_TEST_DATABASE_URL;
test('native event seed preserves data, rejects collisions and adds future dates without duplicates', { skip: !url, timeout: 120000 }, async t => {
  const target = new URL(url!);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55438'); assert.equal(target.username, 'cinehook_verify');
  assert.match(target.pathname, /^\/cinehook_event_seed_[a-z0-9_]+_test$/); assert.equal(target.search, '');
  const pool = new pg.Pool({ connectionString: url, options: '-c timezone=Asia/Kolkata' });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: '-c timezone=UTC' }) });
  // Seed must defend itself even when called by a client whose pool defaults to IST.
  const seedPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: '-c statement_timeout=2000 -c timezone=Asia/Kolkata' }) });
  const options = { expectedDatabase: target.pathname.slice(1), expectedPort: 55438, now: new Date('2099-10-10T00:00:00Z') };
  const snapshot = async () => ({
    events: await prisma.event.findMany({ orderBy: { id: 'asc' } }), people: await prisma.eventPerformer.findMany({ orderBy: [{ eventId: 'asc' }, { name: 'asc' }] }),
    teams: await prisma.eventParticipant.findMany({ orderBy: [{ eventId: 'asc' }, { name: 'asc' }] }), venues: await prisma.eventVenue.findMany({ orderBy: { id: 'asc' } }),
    sections: await prisma.eventSection.findMany({ orderBy: { id: 'asc' } }), seats: await prisma.eventSeat.findMany({ orderBy: { id: 'asc' } }),
    sessions: await prisma.eventSession.findMany({ orderBy: { id: 'asc' } }), prices: await prisma.eventSessionPrice.findMany({ orderBy: [{ sessionId: 'asc' }, { ticketTier: 'asc' }] }),
    users: await prisma.user.findMany({ orderBy: { id: 'asc' } }), cities: await prisma.city.findMany({ orderBy: { id: 'asc' } }),
    bookings: await prisma.booking.findMany({ orderBy: { id: 'asc' } }), quotes: await prisma.eventBookingSeat.findMany({ orderBy: { id: 'asc' } }),
    payments: await prisma.payment.findMany({ orderBy: { id: 'asc' } }), movies: await prisma.movie.findMany({ orderBy: { id: 'asc' } }),
    evidence: await prisma.paymentEvidence.findMany({ orderBy: { providerPaymentId: 'asc' } }), refunds: await prisma.refund.findMany({ orderBy: { id: 'asc' } }),
    reconciliation: await prisma.paymentReconciliation.findMany({ orderBy: { id: 'asc' } }),
  });
  try {
    const actual = (await pool.query('SELECT current_database() AS database,current_schema() AS schema,current_user AS role,inet_server_port() AS port')).rows[0];
    assert.deepEqual(actual, { database: options.expectedDatabase, schema: 'public', role: 'cinehook_verify', port: 55438 });
    assert.equal((await seedPrisma.$queryRaw<Array<{ zone: string }>>`SELECT current_setting('TimeZone') AS zone`)[0]!.zone, 'Asia/Kolkata');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].count, 12);
    assert.equal(await prisma.event.count(), 0, 'Use a NEW isolated task database.');
    await t.test('wrong actual identity and missing existing cities fail without partial data', async () => {
      await assert.rejects(seedEvents(seedPrisma, { ...options, expectedDatabase: 'cinehook_event_seed_wrong_test' }), /identity/);
      await assert.rejects(seedEvents(seedPrisma, options), /existing.*city/i);
      assert.equal(await prisma.event.count(), 0); assert.equal(await prisma.city.count(), 0);
    });
    await prisma.city.createMany({ data: [
      { id: randomUUID(), name: 'New Delhi', state: 'Delhi', countryCode: 'IN' },
      { id: randomUUID(), name: 'Mumbai', state: 'Maharashtra', countryCode: 'IN' },
      { id: randomUUID(), name: 'Bengaluru', state: 'Karnataka', countryCode: 'IN' },
    ] });
    const owner = await prisma.user.create({ data: { id: randomUUID(), email: `${randomUUID()}@example.test`, name: 'Preserved owner', role: 'ADMIN', passwordHash: 'test-only-preserved-hash' } });
    const preservedCities = await prisma.city.findMany({ orderBy: { id: 'asc' } });
    await prisma.movie.create({ data: { title: 'Owner-edited film fixture', description: 'Preserve original movie catalog', language: 'hindi', genres: ['drama'], durationMinutes: 100, releaseDate: new Date('2020-01-01T00:00:00Z'), isActive: false } });
    await t.test('incompatible reserved physical layout fails without replacing seats or creating catalog rows', async () => {
      const sample = EVENT_SAMPLES[0]!, venueId = eventSeedId(`venue:${sample.key}`);
      const sectionId = randomUUID(), seatId = randomUUID();
      const city = preservedCities.find(c => c.name === sample.city.name)!;
      await prisma.eventVenue.create({ data: { id: venueId, cityId: city.id, name: sample.venueName, kind: sample.venueKind, address: 'Test-owned incompatible layout', capacity: 1,
        sections: { create: { id: sectionId, code: 'CUSTOM', name: 'Custom', position: 'FRONT', sortOrder: 0, seats: { create: { id: seatId, rowName: 'Z', seatNumber: 99, ticketTier: 'VIP' } } } } } });
      const before = await snapshot(); await assert.rejects(seedEvents(seedPrisma, options), /layout collision/); assert.deepEqual(await snapshot(), before);
      await prisma.$transaction(async tx => { // Remove only the three explicit fixture IDs created by this test.
        await tx.eventSeat.delete({ where: { id: seatId } }); await tx.eventSection.delete({ where: { id: sectionId } }); await tx.eventVenue.delete({ where: { id: venueId } });
      });
    });
    await t.test('complete city/category inventory, capacity, typed prices and duration snapshots', async () => {
      const result = await seedEvents(seedPrisma, options);
      assert.deepEqual(result.created, { events: 9, performers: 3, participants: 6, venues: 9, sections: 30, seats: 612, sessions: 63, prices: 189 });
      assert.deepEqual(await prisma.city.findMany({ orderBy: { id: 'asc' } }), preservedCities);
      for (const city of preservedCities) {
        const venues = await prisma.eventVenue.findMany({ where: { cityId: city.id }, include: { sections: { include: { seats: true } }, sessions: { include: { event: true, prices: true } } } });
        assert.equal(venues.length, 3); assert.equal(venues.reduce((n, v) => n + v.capacity, 0), 204);
        assert.deepEqual(venues.flatMap(v => v.sessions.slice(0, 1).map(s => s.event.kind)).sort(), ['ACTIVITIES', 'EVENTS', 'SPORTS']);
        for (const venue of venues) {
          assert.equal(venue.sections.reduce((n, section) => n + section.seats.length, 0), venue.capacity);
          assert.ok(venue.sections.every(section => section.seats.every(seat => /^[A-Z]+$/.test(seat.rowName) && seat.seatNumber > 0)));
          for (const session of venue.sessions) {
            assert.ok(session.startsAt > options.now); assert.equal(session.endsAt.getTime() - session.startsAt.getTime(), session.event.durationMinutes * 60000);
            assert.ok(eventStarts(options.now).some(start => start.getTime() === session.startsAt.getTime()), 'Prisma Date parameter must preserve its UTC instant under an IST pool default');
            assert.deepEqual(session.prices.map(p => p.ticketTier).sort(), ['PREMIUM', 'STANDARD', 'VIP']); assert.ok(session.prices.every(p => p.pricePaise > 0));
          }
        }
      }
      assert.deepEqual((await prisma.event.findMany({ where: { kind: 'SPORTS' } })).map(e => e.sport).sort(), ['basketball', 'cricket', 'football']);
      const utc = (await pool.query("SELECT to_char(min(starts_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS starts FROM event_sessions")).rows[0].starts;
      assert.equal(utc, '2099-10-11T07:30:00Z', 'canonical sample hour is 13:00 IST');
      const legacyId = eventSeedId('session:delhi-comedy:2099-10-11T13:00:00.000Z');
      assert.equal((await prisma.eventSession.findUniqueOrThrow({ where: { id: legacyId } })).startsAt.toISOString(), '2099-10-11T07:30:00.000Z', 'original v1 date identity must survive the corrected instant');
      assert.equal((await seedPrisma.$queryRaw<Array<{ zone: string }>>`SELECT current_setting('TimeZone') AS zone`)[0]!.zone, 'Asia/Kolkata', 'transaction UTC setting must not leak to pooled sessions');
      assert.equal((await seedPrisma.$queryRaw<Array<{ timeout: string }>>`SELECT current_setting('statement_timeout') AS timeout`)[0]!.timeout, '2s', 'seed timeout policy must not leak to pooled sessions');
    });
    const allSessions = await prisma.eventSession.findMany({ orderBy: { startsAt: 'asc' } });
    const first = allSessions[0]!;
    const physicalSeat = await prisma.eventSeat.findFirstOrThrow({ where: { section: { venueId: first.venueId } } });
    const price = await prisma.eventSessionPrice.findUniqueOrThrow({ where: { sessionId_ticketTier: { sessionId: first.id, ticketTier: physicalSeat.ticketTier } } });
    const booking = await prisma.booking.create({ data: { userId: owner.id, bookingKind: 'EVENT', eventSessionId: first.id, totalPaise: BigInt(price.pricePaise), expiresAt: new Date(Date.now() + 300000),
      eventSeats: { create: { eventSeatId: physicalSeat.id, price: price.pricePaise } } } });
    const payment = await prisma.payment.create({ data: { bookingId: booking.id, receipt: randomUUID(), amountPaise: BigInt(price.pricePaise) } });
    await prisma.$transaction(async tx => {
      const providerPaymentId = `native_${randomUUID()}`;
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'FAILED', failureCode: 'NATIVE_HISTORY_FIXTURE' } });
      await tx.paymentEvidence.create({ data: { paymentId: payment.id, providerPaymentId, amountPaise: BigInt(price.pricePaise), captured: true } });
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUND_PENDING', providerPaymentId, providerOrderId: `native_order_${randomUUID()}`, capturedAt: new Date(), bookingFinalizedAt: new Date() } });
      await tx.paymentReconciliation.create({ data: { paymentId: payment.id, reason: 'NATIVE_HISTORY_FIXTURE', compensationRequired: true } });
      await tx.refund.create({ data: { paymentId: payment.id, providerPaymentId, amountPaise: BigInt(price.pricePaise), reason: 'NATIVE_HISTORY_FIXTURE' } });
    });
    await t.test('rerun and concurrent seeds preserve edited metadata, credentials, prices and quotes exactly', async () => {
      await prisma.event.update({ where: { id: first.eventId }, data: { title: 'Owner-edited title', description: 'Owner-edited prose', durationMinutes: 95, imageUrl: '/approved-custom.svg' } });
      await prisma.eventPerformer.updateMany({ where: { eventId: first.eventId }, data: { biography: 'Owner edited performer' } });
      const performer = await prisma.eventPerformer.findFirstOrThrow();
      await prisma.eventPerformer.update({ where: { eventId_name: { eventId: performer.eventId, name: performer.name } }, data: { name: 'Owner edited fictional performer', biography: 'Owner-written biography' } });
      const participant = await prisma.eventParticipant.findFirstOrThrow();
      await prisma.eventParticipant.update({ where: { eventId_name: { eventId: participant.eventId, name: participant.name } }, data: { name: 'Owner edited fictional team' } });
      await prisma.eventSessionPrice.update({ where: { sessionId_ticketTier: { sessionId: first.id, ticketTier: physicalSeat.ticketTier } }, data: { pricePaise: price.pricePaise + 1000 } });
      const other = allSessions.find(s => s.id !== first.id)!;
      await prisma.eventSession.update({ where: { id: other.id }, data: { status: 'CANCELLED' } });
      const before = await snapshot();
      assert.deepEqual((await seedEvents(seedPrisma, options)).created, { events: 0, performers: 0, participants: 0, venues: 0, sections: 0, seats: 0, sessions: 0, prices: 0 });
      await Promise.all([seedEvents(seedPrisma, options), seedEvents(seedPrisma, options)]);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('CLI-equivalent seed waits beyond two seconds on the real shared lock without history mutation', async () => {
      const cli = createPrisma(url!); // Exact production CLI connection factory, including its 2s default.
      const holder = await pool.connect();
      let holding = false;
      let pending: Promise<{ result: Awaited<ReturnType<typeof seedEvents>> } | { error: unknown }> | undefined;
      try {
        const before = await snapshot();
        const initial = (await cli.$queryRaw<Array<{ pid: number; timeout: string }>>`SELECT pg_backend_pid() AS pid,current_setting('statement_timeout') AS timeout`)[0]!;
        assert.equal(initial.timeout, '2s');
        await holder.query('BEGIN'); holding = true;
        await holder.query('SELECT pg_advisory_xact_lock(1667853941,1936024932)');
        const began = Date.now();
        pending = seedEvents(cli, options).then(result => ({ result }), error => ({ error }));
        let waiting = false;
        const deadline = Date.now() + 1500;
        while (Date.now() < deadline) {
          const row = (await pool.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1 AND datname=current_database()', [initial.pid])).rows[0];
          if (row?.wait_event_type === 'Lock' && row.wait_event === 'advisory') { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(waiting, true, 'seed must actually block on the shared database advisory lock');
        await new Promise(resolve => setTimeout(resolve, 2300));
        await holder.query('COMMIT'); holding = false;
        const outcome = await pending;
        assert.ok('result' in outcome, `legitimate seed serialization must outlast the app 2s statement limit: ${'error' in outcome ? String(outcome.error) : ''}`);
        assert.ok(Date.now() - began > 2000, 'actual contention must last longer than the application timeout');
        assert.deepEqual(outcome.result.created, { events: 0, performers: 0, participants: 0, venues: 0, sections: 0, seats: 0, sessions: 0, prices: 0 });
        assert.deepEqual(await snapshot(), before);
        assert.equal((await cli.$queryRaw<Array<{ timeout: string }>>`SELECT current_setting('statement_timeout') AS timeout`)[0]!.timeout, '2s');
      } finally {
        if (holding) await holder.query('ROLLBACK');
        if (pending) await pending;
        holder.release(); await cli.$disconnect();
      }
    });
    await t.test('rolling future additions retain cancelled/old dates and use current stored duration only for new sessions', async () => {
      const before = await snapshot();
      const results = await Promise.all([seedEvents(seedPrisma, { ...options, now: new Date('2099-10-11T00:00:00Z') }), seedEvents(seedPrisma, { ...options, now: new Date('2099-10-11T00:00:00Z') })]);
      assert.equal(results.reduce((n, r) => n + r.created.sessions, 0), 9); assert.equal(await prisma.eventSession.count(), 72);
      const after = await snapshot();
      assert.deepEqual(after.sessions.filter(s => before.sessions.some(old => old.id === s.id)), before.sessions);
      assert.deepEqual(after.prices.filter(p => before.sessions.some(old => old.id === p.sessionId)), before.prices);
      assert.deepEqual(after.bookings, before.bookings); assert.deepEqual(after.quotes, before.quotes); assert.deepEqual(after.payments, before.payments); assert.deepEqual(after.users, before.users);
      assert.deepEqual(after.evidence, before.evidence); assert.deepEqual(after.refunds, before.refunds); assert.deepEqual(after.reconciliation, before.reconciliation); assert.deepEqual(after.movies, before.movies);
      const added = after.sessions.find(s => s.eventId === first.eventId && !before.sessions.some(old => old.id === s.id))!;
      assert.equal(added.endsAt.getTime() - added.startsAt.getTime(), 95 * 60000);
    });
    await t.test('inactive events stay inactive and receive no extra sessions', async () => {
      await prisma.event.update({ where: { id: first.eventId }, data: { isActive: false } });
      const before = await prisma.eventSession.count({ where: { eventId: first.eventId } });
      await seedEvents(seedPrisma, { ...options, now: new Date('2099-10-12T00:00:00Z') });
      assert.equal(await prisma.eventSession.count({ where: { eventId: first.eventId } }), before);
      assert.equal((await prisma.event.findUniqueOrThrow({ where: { id: first.eventId } })).isActive, false);
    });
    await t.test('stable event and venue identity collisions roll back the whole run', async () => {
      const sample = EVENT_SAMPLES[0]!; const id = eventSeedId(`event:${sample.key}`);
      const original = await prisma.event.findUniqueOrThrow({ where: { id } });
      await prisma.event.update({ where: { id }, data: { slug: 'user-reserved-slug' } });
      const before = await snapshot();
      await assert.rejects(seedEvents(seedPrisma, { ...options, now: new Date('2099-10-13T00:00:00Z') }), /identity collision/);
      assert.deepEqual(await snapshot(), before);
      await prisma.event.update({ where: { id }, data: { slug: original.slug } }); // Test-owned fixture only.
      const venue = await prisma.eventVenue.findUniqueOrThrow({ where: { id: eventSeedId(`venue:${sample.key}`) } });
      await prisma.eventVenue.update({ where: { id: venue.id }, data: { name: 'User reserved venue' } });
      const venueBefore = await snapshot();
      await assert.rejects(seedEvents(seedPrisma, options), /identity collision/); assert.deepEqual(await snapshot(), venueBefore);
      await prisma.eventVenue.update({ where: { id: venue.id }, data: { name: venue.name } });
    });
    await t.test('a foreign session using a future reserved time is retained and aborts rolling seed', async () => {
      const active = await prisma.event.findFirstOrThrow({ where: { isActive: true } });
      const sample = EVENT_SAMPLES.find(s => s.slug === active.slug)!;
      await prisma.eventSession.create({ data: { id: randomUUID(), eventId: active.id, venueId: eventSeedId(`venue:${sample.key}`), startsAt: new Date('2099-10-20T07:30:00Z'), prices: { create: sample.prices } } });
      const before = await snapshot();
      await assert.rejects(seedEvents(seedPrisma, { ...options, now: new Date('2099-10-13T00:00:00Z') }), /session identity collision/);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('a v1 reserved ID with an arbitrary start is rejected rather than accepted as historical compatibility', async () => {
      const active = await prisma.event.findFirstOrThrow({ where: { isActive: true } });
      const sample = EVENT_SAMPLES.find(s => s.slug === active.slug)!;
      await prisma.eventSession.create({ data: { id: eventSeedId(`session:${sample.key}:2099-10-21T13:00:00.000Z`), eventId: active.id,
        venueId: eventSeedId(`venue:${sample.key}`), startsAt: new Date('2099-10-21T08:00:00Z'), prices: { create: sample.prices } } });
      const before = await snapshot();
      await assert.rejects(seedEvents(seedPrisma, { ...options, now: new Date('2099-10-14T00:00:00Z') }), /session identity collision/);
      assert.deepEqual(await snapshot(), before);
    });
  } finally { await seedPrisma.$disconnect(); await prisma.$disconnect(); await pool.end(); }
});

const legacyUrl = process.env.EVENT_SEED_LEGACY_TEST_DATABASE_URL;
test('pre-fix IST-written v1 dates rerun without duplicate sessions or historical changes', { skip: !legacyUrl, timeout: 120000 }, async () => {
  const target = new URL(legacyUrl!);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55438'); assert.equal(target.username, 'cinehook_verify');
  assert.match(target.pathname, /^\/cinehook_event_seed_[a-z0-9_]+_test$/); assert.equal(target.search, '');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: legacyUrl, options: '-c statement_timeout=2000 -c timezone=Asia/Kolkata' }) });
  const reader = new PrismaClient({ adapter: new PrismaPg({ connectionString: legacyUrl, options: '-c timezone=UTC' }) });
  const options = { expectedDatabase: target.pathname.slice(1), expectedPort: 55438, now: new Date('2099-10-10T00:00:00Z') };
  // This NEW test database was written by the pre-fix seed during the timezone RED run.
  const tables = ['events', 'event_performers', 'event_participants', 'event_venues', 'event_sections', 'event_seats', 'event_sessions', 'event_session_prices',
    'cities', 'users', 'movies', 'bookings', 'event_booking_seats', 'payments', 'payment_evidence', 'payment_reconciliations', 'refunds'];
  const snapshot = async () => Promise.all(tables.map(table => prisma.$queryRawUnsafe(`SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS rows FROM ${table} t`)));
  try {
    const actual = (await prisma.$queryRaw<Array<{ database: string; schema: string; port: number; role: string }>>`SELECT current_database() AS database,current_schema() AS schema,inet_server_port() AS port,current_user AS role`)[0];
    assert.deepEqual(actual, { database: options.expectedDatabase, schema: 'public', port: 55438, role: 'cinehook_verify' });
    const existing = await reader.eventSession.findUniqueOrThrow({ where: { id: eventSeedId('session:delhi-comedy:2099-10-11T13:00:00.000Z') } });
    assert.equal(existing.startsAt.toISOString(), '2099-10-11T07:30:00.000Z');
    const before = await snapshot();
    const results = await Promise.all([seedEvents(prisma, options), seedEvents(prisma, options)]);
    for (const result of results) assert.deepEqual(result.created, { events: 0, performers: 0, participants: 0, venues: 0, sections: 0, seats: 0, sessions: 0, prices: 0 });
    assert.deepEqual(await snapshot(), before);
  } finally { await reader.$disconnect(); await prisma.$disconnect(); }
});
