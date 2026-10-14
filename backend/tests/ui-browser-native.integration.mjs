import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { startUiBrowserFixture } from './ui-browser-server.mjs';

const url = process.env.UI_TEST_DATABASE_URL;
test('native controlled browser fixture exposes movie/event inventory and strict signed raw replay recovery', { skip: !url, timeout: 90000 }, async () => {
  const fixture = await startUiBrowserFixture();
  const origin = fixture.context.origin;
  const get = path => fetch(`${origin}${path}`).then(async r => ({ status: r.status, body: await r.json() }));
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const context = (await get('/__test/context')).body;
    assert.equal(context.localTest, true);
    const listing = await get('/api/events?limit=100');
    assert.equal(listing.status, 200); assert.equal(listing.body.data.items.length, 5);
    const city = await get('/api/cities?limit=100'); assert.equal(city.body.data.items.length, 4);
    for (const kind of ['stage', 'comedy', 'cricket', 'football', 'court']) {
      const info = context.events[kind];
      const detail = await get(`/api/event-sessions/${info.sessionId}`);
      assert.equal(detail.status, 200); assert.equal(detail.body.data.session.venue.capacity, 36);
      assert.equal(detail.body.data.session.venue.sections.flatMap(s => s.seats).length, 36);
      const availability = await get(`/api/event-sessions/${info.sessionId}/availability`);
      assert.equal(availability.body.data.seats.filter(s => s.availability === 'BOOKED').length, 1);
      assert.equal(availability.body.data.seats.filter(s => s.availability === 'LOCKED').length, 2);
    }
    const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'fan@cinehook.test', password: 'UI-only-password-123!' }) });
    assert.equal(login.status, 200); const token = (await login.json()).data.accessToken;
    const headers = { 'content-type': 'application/json', Authorization: `Bearer ${token}` };
    const post = (path, body, extra = {}) => fetch(`${origin}${path}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    const created = await post('/api/event-bookings', { eventSessionId: context.events.stage.sessionId, seatIds: [context.events.stage.availableSeatIds[0]] });
    assert.equal(created.status, 201); const booking = (await created.json()).data.booking;
    const ordered = await post('/api/payments/order', { bookingId: booking.id });
    assert.equal(ordered.status, 201); const order = (await ordered.json()).data.order;
    const state = (await get('/__test/context')).body;
    assert.ok(state.orders.some(value => value.bookingId === booking.id && value.orderId === order.id));
    assert.equal((await post('/__test/recover', { orderId: order.id })).status, 403);
    assert.equal((await post('/__test/recover', { orderId: order.id, paid: true }, { origin })).status, 400);
    const recovered = await post('/__test/recover', { orderId: order.id }, { origin });
    assert.equal(recovered.status, 200); const first = await recovered.json();
    const replayed = await post('/__test/replay', { orderId: order.id }, { origin });
    assert.equal(replayed.status, 200); assert.equal((await replayed.json()).eventId, first.eventId);
    const counts = (await pool.query('SELECT (SELECT count(*)::int FROM payment_webhook_events WHERE provider_event_id=$1) AS events, (SELECT count(*)::int FROM event_confirmed_seats cs JOIN event_booking_seats bs ON bs.id=cs.booking_seat_id WHERE bs.booking_id=$2) AS allocations', [first.eventId, booking.id])).rows[0];
    assert.deepEqual(counts, { events: 1, allocations: 1 });
    const summary = await fetch(`${origin}/api/bookings/${booking.id}/summary`, { headers });
    assert.equal((await summary.json()).data.booking.status, 'CONFIRMED');
  } finally { await fixture.close(); await pool.end(); }
});
