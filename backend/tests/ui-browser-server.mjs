// Local browser test fixture only. Never imported by src/server.ts or included
// in the production bundle. Real domain services use disposable PG + Redis;
// only the Razorpay HTTP transport and checkout UI are controlled here.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import bcrypt from 'bcrypt';
import express from 'express';
import { createClient } from 'redis';

const fixturePort = 55440;
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function validateFixtureTargets(databaseUrl, redisUrl) {
  try {
    const db = new URL(databaseUrl), cache = new URL(redisUrl);
    assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
    assert.ok(loopback.has(db.hostname) && /^\/[A-Za-z0-9_]+_test$/.test(db.pathname));
    assert.equal(db.port, '55438'); assert.equal(db.username, 'cinehook_verify'); assert.equal(db.password, '');
    assert.ok(['redis:', 'rediss:'].includes(cache.protocol));
    assert.ok(loopback.has(cache.hostname) && cache.pathname === '/15');
    assert.equal(cache.port, '55439'); assert.equal(cache.username, ''); assert.equal(cache.password, '');
    assert.equal(db.search, ''); assert.equal(cache.search, '');
    return { databaseUrl, redisUrl };
  } catch {
    throw new Error('UI fixture requires explicit loopback *_test PostgreSQL and loopback Redis database 15.');
  }
}

export function validateControlledOrderRequest(origin, body) {
  assert.equal(origin, fixtureOrigin, 'Explicit local test origin required.');
  assert.ok(body && typeof body === 'object' && !Array.isArray(body));
  assert.deepEqual(Object.keys(body), ['orderId']);
  assert.match(body.orderId ?? '', /^order_[A-Za-z0-9]{1,64}$/);
  return body.orderId;
}

// No network call leaves this function. It returns actual Razorpay-shaped HTTP
// responses for the production adapter to validate, normalize and authenticate.
export function createControlledProviderTransport(credentials, now = Date.now, inTransaction = () => false) {
  const orders = new Map(), payments = new Map(), refunds = new Map(), refundKeys = new Map(), webhooks = new Map();
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const notFound = () => response({ error: { code: 'BAD_REQUEST_ERROR', description: 'Local test entity not found.' } }, 404);
  const id = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;
  const fail = orderId => {
    const order = orders.get(orderId);
    if (!order || [...payments.values()].some(value => value.order_id === orderId && value.status !== 'failed')) throw new Error('Unknown or already captured local test order.');
    const existing = [...payments.values()].find(value => value.order_id === orderId);
    if (existing) return existing;
    const value = { id: id('pay'), entity: 'payment', order_id: order.id, amount: order.amount,
      currency: order.currency, status: 'failed', captured: false };
    payments.set(value.id, value); return value;
  };
  const capture = orderId => {
    const order = orders.get(orderId);
    if (!order) throw new Error('Unknown local test order.');
    let payment = [...payments.values()].find(value => value.order_id === orderId);
    if (!payment) {
      payment = { id: id('pay'), entity: 'payment', order_id: order.id, amount: order.amount,
        currency: order.currency, status: 'captured', captured: true };
      payments.set(payment.id, payment); order.status = 'paid';
    }
    return { razorpay_order_id: order.id, razorpay_payment_id: payment.id,
      razorpay_signature: createHmac('sha256', credentials.keySecret).update(`${order.id}|${payment.id}`).digest('hex') };
  };
  const transport = async (input, options = {}) => {
    assert.notEqual(inTransaction(), true, 'Provider transport must execute outside database transactions.');
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.razorpay.com');
    assert.equal(new Headers(options.headers).get('Authorization'), `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString('base64')}`);
    const method = options.method ?? 'GET';
    if (url.pathname === '/v1/orders' && method === 'POST') {
      const body = JSON.parse(options.body);
      assert.equal(body.partial_payment, false);
      if ([...orders.values()].some(order => order.receipt === body.receipt)) {
        return response({ error: { code: 'BAD_REQUEST_ERROR', description: 'Receipt already exists.' } }, 400);
      }
      const order = { id: id('order'), entity: 'order', ...body, status: 'created' };
      orders.set(order.id, order); return response(order);
    }
    if (url.pathname === '/v1/orders' && method === 'GET') {
      return response({ entity: 'collection', items: [...orders.values()].filter(order => order.receipt === url.searchParams.get('receipt')) });
    }
    const orderMatch = /^\/v1\/orders\/(order_[A-Za-z0-9]+)$/.exec(url.pathname);
    if (orderMatch && method === 'GET') return orders.has(orderMatch[1]) ? response(orders.get(orderMatch[1])) : notFound();
    const refundCreate = /^\/v1\/payments\/(pay_[A-Za-z0-9]+)\/refund$/.exec(url.pathname);
    if (refundCreate && method === 'POST') {
      const payment = payments.get(refundCreate[1]); if (!payment) return notFound();
      const body = JSON.parse(options.body), key = new Headers(options.headers).get('X-Refund-Idempotency');
      assert.ok(key); assert.equal(body.speed, 'normal');
      assert.equal(body.amount, payment.amount); // This fixture exercises full-refund policy.
      if (refundKeys.has(key)) return response(refunds.get(refundKeys.get(key)).value);
      const refund = { id: id('rfnd'), entity: 'refund', payment_id: payment.id, amount: payment.amount,
        currency: payment.currency, receipt: body.receipt, status: 'pending' };
      refunds.set(refund.id, { value: refund, requestedAt: now() }); refundKeys.set(key, refund.id);
      return response(refund);
    }
    const refundMatch = /^\/v1\/refunds\/(rfnd_[A-Za-z0-9]+)$/.exec(url.pathname);
    if (refundMatch && method === 'GET') {
      const refund = refunds.get(refundMatch[1]); if (!refund) return notFound();
      if (now() - refund.requestedAt >= 2000) {
        refund.value.status = 'processed';
        payments.get(refund.value.payment_id).status = 'refunded';
      }
      return response(refund.value);
    }
    const paymentMatch = /^\/v1\/payments\/(pay_[A-Za-z0-9]+)$/.exec(url.pathname);
    if (paymentMatch && method === 'GET') return payments.has(paymentMatch[1]) ? response(payments.get(paymentMatch[1])) : notFound();
    throw new Error('Unsupported local test provider request.');
  };
  const capturedWebhook = orderId => {
    if (webhooks.has(orderId)) return webhooks.get(orderId);
    const captured = capture(orderId), payment = payments.get(captured.razorpay_payment_id);
    assert.equal(payment.status, 'captured');
    const raw = Buffer.from(JSON.stringify({ entity: 'event', event: 'payment.captured', payload: { payment: { entity: payment } } }));
    const result = { raw, signature: createHmac('sha256', credentials.webhookSecret).update(raw).digest('hex'), eventId: id('evt') };
    webhooks.set(orderId, result); return result;
  };
  return { transport, capture, fail, capturedWebhook };
}

const sdkScript = `(() => {
  class LocalTestCheckout {
    constructor(options) { this.options = options; this.events = new Map(); this.overlay = null; }
    on(event, handler) { this.events.set(event, handler); }
    close() { if (this.overlay) { this.overlay.remove(); this.overlay = null; } }
    open() {
      this.close();
      const overlay = document.createElement('div');
      Object.assign(overlay.style, {position:'fixed',inset:'0',zIndex:'99999',background:'rgba(0,0,0,.88)',display:'grid',placeItems:'center',padding:'24px'});
      const dialog = document.createElement('section');
      dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true'); dialog.setAttribute('aria-labelledby','local-test-checkout-title');
      Object.assign(dialog.style, {width:'min(480px,100%)',background:'#15151c',color:'#fff',padding:'28px',border:'2px solid #e50914',borderRadius:'18px',fontFamily:'system-ui'});
      const title = document.createElement('h2'); title.id = 'local-test-checkout-title'; title.textContent = 'LOCAL TEST CHECKOUT — no real money';
      const description = document.createElement('p'); description.textContent = 'This local provider fixture exercises the real booking, signature verification and refund APIs. Your booking is valid only after the server confirms it.';
      const feedback = document.createElement('p'); feedback.setAttribute('role','status');
      const complete = document.createElement('button'); complete.type = 'button'; complete.textContent = 'Complete test payment';
      const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Close test checkout';
      for (const button of [complete,dismiss]) Object.assign(button.style, {display:'block',minHeight:'44px',width:'100%',marginTop:'12px',padding:'12px',borderRadius:'10px',border:'1px solid #2a2a34',color:'#fff',background:button===complete?'#e50914':'#1b1b24',cursor:'pointer'});
      const cancel = () => { this.close(); if (this.options.modal && this.options.modal.ondismiss) this.options.modal.ondismiss(); };
      dismiss.onclick = cancel;
      dialog.onkeydown = event => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        if (event.key === 'Tab') { event.preventDefault(); (document.activeElement === complete ? dismiss : complete).focus(); }
      };
      complete.onclick = async () => {
        complete.disabled = true; dismiss.disabled = true; feedback.textContent = 'Recording local test capture…';
        try {
          const response = await fetch('/__test/capture', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:this.options.order_id})});
          if (!response.ok) throw new Error('Local test capture could not be recorded.');
          const signature = await response.json(); this.close(); await this.options.handler(signature);
        } catch (error) {
          feedback.textContent = error instanceof Error ? error.message : 'Local test checkout failed.';
          complete.disabled = false; dismiss.disabled = false;
          const failure = this.events.get('payment.failed'); if (failure) failure({error:{code:'LOCAL_TEST_FAILURE',description:'Local test checkout could not complete.'}});
        }
      };
      dialog.append(title,description,feedback,complete,dismiss); overlay.append(dialog); document.body.append(overlay); this.overlay = overlay; complete.focus();
    }
  }
  window.Razorpay = LocalTestCheckout;
  window.__CINEHOOK_LOCAL_TEST_CHECKOUT__ = true;
})();`;

const uuid = value => `55440000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const fixtureIds = { user: uuid(1), admin: uuid(2), otherUser: uuid(3), city: uuid(10), theatre: uuid(11), screen: uuid(12),
  interstellar: uuid(20), dune: uuid(21), oppenheimer: uuid(22), batman: uuid(23), upcoming: uuid(24),
  interstellarShow: uuid(30), duneShow: uuid(31), bookedBooking: uuid(40), heldBooking: uuid(41) };
const seatRows = ['A', 'B', 'C', 'D', 'E', 'F'];
const seats = seatRows.flatMap((rowName, rowIndex) => Array.from({ length: 8 }, (_, index) => ({
  id: uuid(100 + rowIndex * 8 + index), screenId: fixtureIds.screen, rowName, seatNumber: index + 1,
  seatType: rowIndex < 2 ? 'REGULAR' : rowIndex < 4 ? 'PREMIUM' : 'RECLINER',
})));

const eventFixtures = Object.fromEntries([
  ['stage', 'EVENTS', null, 'Sample stage evening', 'AUDITORIUM'],
  ['comedy', 'EVENTS', null, 'Sample comedy evening', 'AUDITORIUM'],
  ['cricket', 'SPORTS', 'cricket', 'Sample cricket match', 'STADIUM'],
  ['football', 'SPORTS', 'football', 'Sample football match', 'STADIUM'],
  ['court', 'SPORTS', 'basketball', 'Sample court match', 'ARENA'],
].map(([key, kind, sport, title, venueKind], index) => {
  const venueId = uuid(1100 + index), eventId = uuid(1000 + index), sessionId = uuid(1200 + index);
  const positions = venueKind === 'AUDITORIUM' ? ['FRONT', 'MIDDLE', 'REAR'] : ['NORTH', 'EAST', 'SOUTH', 'WEST'];
  const sections = positions.map((position, sectionIndex) => ({ id: uuid(3000 + index * 10 + sectionIndex), venueId,
    code: position, name: `${position[0]}${position.slice(1).toLowerCase()} section`, position: position === 'MIDDLE' ? 'REAR' : position, sortOrder: sectionIndex,
    seats: ['A', 'B', 'C'].flatMap((rowName, rowIndex) => Array.from({ length: venueKind === 'AUDITORIUM' ? 4 : 3 }, (_, seatIndex) => ({
      id: uuid(2000 + index * 100 + sectionIndex * 20 + rowIndex * 5 + seatIndex), rowName, seatNumber: seatIndex + 1,
      ticketTier: ['STANDARD', 'PREMIUM', 'VIP'][sectionIndex % 3],
    }))),
  }));
  return [key, { key, kind, sport, title, venueKind, eventId, venueId, sessionId, sections }];
}));

const recoveryHtml = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local test recovery</title>
<body style="background:#15151c;color:white;font-family:system-ui;padding:24px"><h1>LOCAL TEST CHECKOUT — no real money</h1>
<p>After closing checkout without callback, paste the server order ID from checkout/context. Recovery sends a signed raw capture webhook through the real API. Replay resends the identical event.</p>
<label>Local order ID <input id="order" style="width:min(100%,450px)" placeholder="order_..."></label>
<button id="recover">Recover through signed webhook</button><button id="replay">Replay identical webhook</button><pre id="result"></pre>
<a href="/bookings">Return to My Bookings</a><script>
for(const action of ['recover','replay'])document.getElementById(action).onclick=async()=>{
const response=await fetch('/__test/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({orderId:document.getElementById('order').value})});
document.getElementById('result').textContent=JSON.stringify(await response.json(),null,2);};
</script></body></html>`;

export async function startUiBrowserFixture(env = process.env) {
  // Reject wrong targets before creating clients, reading schemas or writing.
  const targets = validateFixtureTargets(env.UI_TEST_DATABASE_URL, env.SEAT_LOCK_TEST_REDIS_URL);
  const reservation = createServer();
  await new Promise((done, reject) => { reservation.once('error', reject); reservation.listen(fixturePort, '127.0.0.1', done); });
  await new Promise(done => reservation.close(done));
  const directory = dirname(fileURLToPath(import.meta.url));
  const frontendDist = resolve(directory, '../../frontend/dist');
  const indexPath = resolve(frontendDist, 'index.html');
  assert.ok((await stat(indexPath)).isFile(), 'Build frontend/dist before starting the UI fixture.');
  const builtHtml = await readFile(indexPath, 'utf8');
  assert.match(builtHtml, /<head>/i, 'Frontend index must provide its expected HTML entry point.');
  const servedHtml = builtHtml.replace(/<head>/i, '<head><script src="/__test/checkout.js"></script>');
  // Load built production services only when explicitly starting the browser
  // server. Safety/transport unit tests must work before `npm run build` in CI.
  const [{ createApp }, { createPrisma }, { AuthService }, { TokenService }, { UserRepository },
    { createCatalog }, { createShows }, { BookingRepository }, { BookingService }, { SeatLockService },
    { PaymentRepository }, { PaymentService }, { RazorpayProvider },
    { PricingRepository }, { PricingService }, { cinemaSimulationPolicy }, { eventSimulationPolicy },
    { RefundRepository }, { RefundService },
    { HealthRepository }, { HealthService }, { createUiRead }, { createAccount }, { createWishlist },
    { createEvents }, { EventBookingRepository }, { EventBookingService }, { BookingGateway }, { BookingTargetRepository },
    { DemoCatalogRepository }, { DemoCatalogService }] = await Promise.all([
    '../dist/app.js', '../dist/lib/prisma.js', '../dist/modules/auth/auth.service.js', '../dist/modules/auth/token.service.js',
    '../dist/modules/auth/user.repository.js', '../dist/modules/catalog/create-catalog.js', '../dist/modules/shows/create-shows.js',
    '../dist/modules/booking/booking.repository.js', '../dist/modules/booking/booking.service.js', '../dist/modules/seat-lock/seat-lock.service.js',
    '../dist/modules/payments/payment.repository.js', '../dist/modules/payments/payment.service.js', '../dist/modules/payments/razorpay.provider.js',
    '../dist/modules/pricing/pricing.repository.js', '../dist/modules/pricing/pricing.service.js',
    '../dist/modules/pricing/cinema-simulation.js', '../dist/modules/pricing/cinema-simulation.js',
    '../dist/modules/refunds/refund.repository.js', '../dist/modules/refunds/refund.service.js', '../dist/modules/health/health.repository.js',
    '../dist/modules/health/health.service.js', '../dist/modules/ui-read/create-ui-read.js',
    '../dist/modules/account/create-account.js', '../dist/modules/wishlist/create-wishlist.js',
    '../dist/modules/events/create-events.js', '../dist/modules/event-booking/event-booking.repository.js', '../dist/modules/event-booking/event-booking.service.js',
    '../dist/modules/booking/booking-gateway.js', '../dist/modules/booking/booking-target.repository.js',
    '../dist/modules/demo-catalog/demo-catalog.repository.js', '../dist/modules/demo-catalog/demo-catalog.service.js',
  ].map(path => import(path)));
  const prisma = createPrisma(targets.databaseUrl);
  const redis = createClient({ url: targets.redisUrl, disableOfflineQueue: true, socket: { reconnectStrategy: false, connectTimeout: 2000 } });
  redis.on('error', () => console.error(JSON.stringify({ event: 'ui_test_redis_unavailable' })));
  const txContext = new AsyncLocalStorage();
  const originalTransaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (work, options) => typeof work === 'function'
    ? originalTransaction(tx => txContext.run(true, () => work(tx)), options) : originalTransaction(work, options);
  const locks = new SeatLockService(redis);
  const eventLocks = new SeatLockService(redis, 'event');
  const eventBooking = new EventBookingService(new EventBookingRepository(prisma), eventLocks);
  const initialBookingIds = [fixtureIds.bookedBooking, fixtureIds.heldBooking];
  const booking = { bookings: new BookingGateway(new BookingTargetRepository(prisma),
    new BookingService(new BookingRepository(prisma), locks, () => initialBookingIds.shift() ?? randomUUID()), eventBooking) };
  const tokens = new TokenService({ secret: randomBytes(48).toString('hex'), expiresInSeconds: 3600 });
  const credentials = { keyId: 'rzp_test_LOCAL_UI_ONLY', keySecret: randomBytes(32).toString('hex'), webhookSecret: randomBytes(48).toString('hex') };
  const localProvider = createControlledProviderTransport(credentials, Date.now, () => txContext.getStore() === true);
  const provider = new RazorpayProvider(credentials, localProvider.transport);
  const refunds = new RefundService(new RefundRepository(prisma), booking.bookings, provider);
  const pricing = new PricingRepository(prisma, 'controlled-test');
  const payments = { payments: new PaymentService(new PaymentRepository(prisma, pricing), booking.bookings, provider, refunds), refunds };
  const catalog = createCatalog(prisma), shows = createShows(prisma);
  const auth = { service: new AuthService(new UserRepository(prisma), tokens), tokens };
  let server, stopping = false, phase = 'database_preflight';
  const close = async () => {
    if (stopping) return;
    stopping = true;
    if (server) await new Promise(done => { server.close(done); server.closeIdleConnections(); });
    // Leave database records recoverable. Release only this fixture's surviving
    // holds, using the same fenced ownership protocol as production. No flush.
    if (redis.isReady) {
      const held = await prisma.booking.findMany({ where: { status: 'PENDING', OR: [{ show: { screenId: fixtureIds.screen } },
        { eventSessionId: { in: Object.values(eventFixtures).map(value => value.sessionId) } }] },
        select: { id: true, userId: true, showId: true, eventSessionId: true, seats: { select: { seatId: true } }, eventSeats: { select: { eventSeatId: true } } } }).catch(() => []);
      await Promise.allSettled(held.map(value => value.eventSessionId
        ? eventLocks.release(value.eventSessionId, value.eventSeats.map(seat => seat.eventSeatId), value.userId, value.id)
        : locks.release(value.showId, value.seats.map(seat => seat.seatId), value.userId, value.id)));
    }
    await Promise.allSettled([prisma.$disconnect(), redis.isOpen ? redis.quit() : Promise.resolve()]);
  };
  try {
    const db = await prisma.$queryRaw`SELECT current_database() AS name,current_schema() AS schema,current_user AS role,inet_server_port() AS port`;
    assert.deepEqual(db[0], { name: new URL(targets.databaseUrl).pathname.slice(1), schema: 'public', role: 'cinehook_verify', port: 55438 });
    const counts = await Promise.all([prisma.user.count(), prisma.movie.count(), prisma.city.count(), prisma.show.count(), prisma.booking.count(),
      prisma.event.count(), prisma.eventVenue.count(), prisma.eventSection.count(), prisma.eventSeat.count(), prisma.eventSession.count(), prisma.demoListing.count()]);
    assert.ok(counts.every(count => count === 0), 'UI fixture needs a fresh empty *_test database. Existing records are never replaced or deleted.');
    phase = 'redis_preflight';
    await redis.connect();
    const collisionKeys = [fixtureIds.interstellarShow, fixtureIds.duneShow].flatMap(showId => seats.map(seat => `cinehook:seat-lock:{${showId}}:${seat.id}`));
    collisionKeys.push(...Object.values(eventFixtures).flatMap(value => value.sections.flatMap(section => section.seats.map(seat => `cinehook:event-seat-lock:{${value.sessionId}}:${seat.id}`))));
    assert.equal(await redis.exists(collisionKeys), 0, 'Existing fixture seat keys must expire or be fenced-released before a new seed.');
    phase = 'seed_native_catalog';
    const passwordHash = await bcrypt.hash('UI-only-password-123!', 12);
    await prisma.$transaction(async tx => {
      await tx.user.createMany({ data: [
        { id: fixtureIds.user, name: 'Local test fan', email: 'fan@cinehook.test', passwordHash, role: 'USER' },
        { id: fixtureIds.admin, name: 'Local test administrator', email: 'admin@cinehook.test', passwordHash, role: 'ADMIN' },
        { id: fixtureIds.otherUser, name: 'Local test other fan', email: 'other@cinehook.test', passwordHash, role: 'USER' },
      ] });
      await tx.city.create({ data: { id: fixtureIds.city, name: 'Greater Noida', state: 'Uttar Pradesh', countryCode: 'IN' } });
      await tx.city.createMany({ data: [
        { id: uuid(13), name: 'New Delhi', state: 'Delhi' }, { id: uuid(14), name: 'Mumbai', state: 'Maharashtra' }, { id: uuid(15), name: 'Bengaluru', state: 'Karnataka' },
      ] });
      await tx.theatre.create({ data: { id: fixtureIds.theatre, cityId: fixtureIds.city, name: 'PVR Logix', address: 'Local browser fixture venue, Greater Noida' } });
      await tx.screen.create({ data: { id: fixtureIds.screen, theatreId: fixtureIds.theatre, name: 'Screen 1', capacity: 48 } });
      await tx.seat.createMany({ data: seats });
      await tx.movie.createMany({ data: [
        { id: fixtureIds.interstellar, title: 'Interstellar', description: 'A team of explorers travels beyond this galaxy to discover whether mankind has a future among the stars.', durationMinutes: 169, releaseDate: new Date('2014-11-07'), language: 'english', genres: ['sci-fi', 'drama'], posterUrl: null },
        { id: fixtureIds.dune, title: 'Dune: Part Two', description: 'Paul Atreides joins the Fremen as the future of Arrakis hangs in the balance.', durationMinutes: 166, releaseDate: new Date('2024-03-01'), language: 'english', genres: ['sci-fi', 'adventure'], posterUrl: null },
        { id: fixtureIds.oppenheimer, title: 'Oppenheimer', description: 'A historical drama about J. Robert Oppenheimer and the development of the atomic bomb.', durationMinutes: 180, releaseDate: new Date('2023-07-21'), language: 'english', genres: ['drama', 'biography'], posterUrl: null },
        { id: fixtureIds.batman, title: 'The Batman', description: 'Batman follows a trail of clues through Gotham City while confronting its corruption.', durationMinutes: 176, releaseDate: new Date('2022-03-04'), language: 'english', genres: ['action', 'crime'], posterUrl: null },
        { id: fixtureIds.upcoming, title: 'CineHook upcoming release', description: 'Clearly labelled local test catalog fixture for the Coming Soon layout.', durationMinutes: 120, releaseDate: new Date('2099-12-01'), language: 'english', genres: ['drama'], posterUrl: null },
      ] });
      const priceRows = [{ seatType: 'REGULAR', pricePaise: 30000 }, { seatType: 'PREMIUM', pricePaise: 45000 }, { seatType: 'RECLINER', pricePaise: 60000 }];
      for (const [showId, movieId, startsAt, minutes] of [
        [fixtureIds.interstellarShow, fixtureIds.interstellar, new Date('2099-10-10T14:00:00Z'), 169],
        [fixtureIds.duneShow, fixtureIds.dune, new Date('2099-10-11T14:00:00Z'), 166],
      ]) await tx.show.create({ data: { id: showId, movieId, screenId: fixtureIds.screen, startsAt,
        endsAt: new Date(startsAt.getTime() + minutes * 60000), prices: { create: priceRows } } });
      for (const [index, value] of Object.values(eventFixtures).entries()) {
        await tx.event.create({ data: { id: value.eventId, slug: `local-test-${value.key}`, title: value.title,
          description: 'Fictional local browser test inventory; no real performers, teams or money.', kind: value.kind, sport: value.sport,
          durationMinutes: 90, imageUrl: `/demo-category-art/${value.kind === 'SPORTS' ? 'sports' : 'events'}.svg`,
          imageAttribution: 'CineHook original sample artwork', isSample: true,
          ...(value.kind === 'EVENTS' ? { performers: { create: { name: 'Sample performer', biography: 'Fictional local test performer.' } } }
            : { participants: { create: [{ name: 'Sample team A' }, { name: 'Sample team B' }] } }) } });
        await tx.eventVenue.create({ data: { id: value.venueId, cityId: fixtureIds.city, name: `Sample ${value.key} venue`,
          address: 'Fictional local test location', kind: value.venueKind, capacity: 36,
          sections: { create: value.sections.map(({ venueId: _venueId, seats: physical, ...section }) => ({ ...section, seats: { create: physical } })) } } });
        await tx.eventSession.create({ data: { id: value.sessionId, eventId: value.eventId, venueId: value.venueId,
          startsAt: new Date(`2099-10-${String(12 + index).padStart(2, '0')}T14:00:00Z`),
          prices: { create: [{ ticketTier: 'STANDARD', pricePaise: 15000 }, { ticketTier: 'PREMIUM', pricePaise: 25000 }, { ticketTier: 'VIP', pricePaise: 40000 }] } } });
      }
      await tx.pricingTaxPolicy.createMany({ data: [
        { key: `movie:${fixtureIds.theatre}:2025-09-22`, verifiedBy: 'Isolated controlled checkout fixture', settings: { ...cinemaSimulationPolicy, feeWaiverStartsAt: '2025-09-22T00:00:00+05:30' } },
        ...Object.values(eventFixtures).map(value => ({ key: `event:${value.eventId}:simulation-v1`, verifiedBy: 'Isolated controlled checkout fixture', settings: { ...eventSimulationPolicy, feeWaiverStartsAt: '2025-09-22T00:00:00+05:30' } })),
      ] });
      await tx.demoListing.createMany({ data: [
        { slug: 'local-stream', kind: 'STREAM', title: 'Sample streaming showcase', description: 'Local read-only sample; booking unavailable.', category: 'Film', imageUrl: '/demo-category-art/stream.svg', imageAttribution: 'CineHook original sample artwork' },
        { slug: 'local-activity', kind: 'ACTIVITIES', title: 'Sample activity showcase', description: 'Local read-only sample; booking unavailable.', category: 'Workshop', cityName: 'Greater Noida', venueName: 'Fictional sample studio', imageUrl: '/demo-category-art/activities.svg', imageAttribution: 'CineHook original sample artwork' },
      ] });
    }, { timeout: 10000 });
    phase = 'seed_paid_booking';
    const booked = await booking.bookings.create(fixtureIds.otherUser, { showId: fixtureIds.interstellarShow, seatIds: [seats[0].id] });
    const order = await payments.payments.order(fixtureIds.otherUser, booked.id);
    const capture = localProvider.capture(order.order.id);
    await payments.payments.verify(fixtureIds.otherUser, { bookingId: booked.id, ...capture });
    assert.equal((await booking.bookings.getById(fixtureIds.otherUser, booked.id)).status, 'CONFIRMED');
    phase = 'seed_temporary_hold';
    const held = await booking.bookings.create(fixtureIds.otherUser, { showId: fixtureIds.interstellarShow, seatIds: [seats[1].id] });
    // Additional status cases use the real services and cryptographically
    // verified controlled-provider evidence, not manually edited financial rows.
    phase = 'seed_customer_financial_states';
    const failedBooking = await booking.bookings.create(fixtureIds.user, { showId: fixtureIds.duneShow, seatIds: [seats[8].id] });
    const failedOrder = await payments.payments.order(fixtureIds.user, failedBooking.id);
    const failedEvidence = localProvider.fail(failedOrder.order.id);
    const failedBody = Buffer.from(JSON.stringify({ entity: 'event', event: 'payment.failed', payload: { payment: { entity: failedEvidence } } }));
    await payments.payments.webhook(failedBody, createHmac('sha256', credentials.webhookSecret).update(failedBody).digest('hex'), `evt_${randomUUID().replaceAll('-', '')}`);
    assert.equal((await prisma.payment.findUnique({ where: { bookingId: failedBooking.id } })).status, 'FAILED');
    const unfulfilled = await booking.bookings.create(fixtureIds.user, { showId: fixtureIds.duneShow, seatIds: [seats[9].id] });
    const unfulfilledOrder = await payments.payments.order(fixtureIds.user, unfulfilled.id);
    await booking.bookings.releaseHold(fixtureIds.user, unfulfilled.id);
    const unfulfilledCapture = localProvider.capture(unfulfilledOrder.order.id);
    await payments.payments.verify(fixtureIds.user, { bookingId: unfulfilled.id, ...unfulfilledCapture });
    assert.equal((await booking.bookings.getById(fixtureIds.user, unfulfilled.id)).status, 'CANCELLED');
    assert.equal((await prisma.payment.findUnique({ where: { bookingId: unfulfilled.id } })).status, 'REFUND_PENDING');
    phase = 'seed_event_service_states';
    const eventContext = {};
    for (const value of Object.values(eventFixtures)) {
      const physical = value.sections.flatMap(section => section.seats);
      const confirmed = await eventBooking.create(fixtureIds.otherUser, { eventSessionId: value.sessionId, seatIds: [physical[0].id] });
      const paid = await payments.payments.order(fixtureIds.otherUser, confirmed.id);
      await payments.payments.verify(fixtureIds.otherUser, { bookingId: confirmed.id, ...localProvider.capture(paid.order.id) });
      assert.equal((await booking.bookings.getById(fixtureIds.otherUser, confirmed.id)).status, 'CONFIRMED');
      const otherHeld = await eventBooking.create(fixtureIds.otherUser, { eventSessionId: value.sessionId, seatIds: [physical[1].id] });
      const ownerHeld = await eventBooking.create(fixtureIds.user, { eventSessionId: value.sessionId, seatIds: [physical[2].id] });
      eventContext[value.key] = { eventId: value.eventId, sessionId: value.sessionId, venueId: value.venueId, title: value.title,
        capacity: 36, sections: value.sections.map(section => ({ id: section.id, code: section.code, seats: section.seats })),
        confirmedBookingId: confirmed.id, otherHeldBookingId: otherHeld.id, ownerHeldBookingId: ownerHeld.id,
        ownerHoldExpiresAt: ownerHeld.expiresAt, availableSeatIds: physical.slice(3).map(seat => seat.id) };
    }
    phase = 'create_api';
    const api = createApp({ frontendOrigin: fixtureOrigin, auth, catalog, shows, booking, payments, pricing: new PricingService(pricing, booking.bookings), events: createEvents(prisma), eventBooking,
      demoCatalog: new DemoCatalogService(new DemoCatalogRepository(prisma)),
      account: createAccount(prisma), wishlist: createWishlist(prisma),
      uiRead: createUiRead(prisma, booking.bookings), healthService: new HealthService(new HealthRepository(prisma, redis)) });
    const context = { localTest: true, origin: fixtureOrigin, fixtureIds, accounts: { user: 'fan@cinehook.test', admin: 'admin@cinehook.test' },
      seats: seats.map(seat => ({ id: seat.id, rowName: seat.rowName, seatNumber: seat.seatNumber, seatType: seat.seatType })),
      bookingExamples: { booked: { id: booked.id, seat: 'A1', status: 'CONFIRMED' },
        held: { id: held.id, seat: 'A2', status: 'PENDING', expiresAt: held.expiresAt }, available: ['A3', 'A4'] },
      financialExamples: { failedPaymentBookingId: failedBooking.id, unfulfilledPaymentBookingId: unfulfilled.id },
      events: eventContext, inventoryCounts: { cities: 4, movies: 5, movieSeats: 48, events: 5, eventSessions: 5, eventSeats: 180, eventPrices: 15 },
      recovery: { ui: '/__test/recovery', recover: '/__test/recover', replay: '/__test/replay', payload: '{"orderId":"order_..."}' },
      refundProviderDelayMs: 2000 };
    const gateway = express();
    gateway.disable('x-powered-by');
    gateway.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    gateway.get('/__test/health', (_req, res) => res.json({ localTest: true, status: 'ready' }));
    gateway.get('/__test/context', async (_req, res) => {
      const records = await prisma.payment.findMany({ select: { bookingId: true, providerOrderId: true, status: true,
        booking: { select: { status: true, bookingKind: true } } }, orderBy: { createdAt: 'asc' } });
      res.json({ ...context, orders: records.map(value => ({ bookingId: value.bookingId, orderId: value.providerOrderId,
        paymentStatus: value.status, bookingStatus: value.booking.status, bookingKind: value.booking.bookingKind })) });
    });
    gateway.get('/__test/recovery', (_req, res) => res.type('html').send(recoveryHtml));
    gateway.get('/__test/checkout.js', (_req, res) => res.type('application/javascript').send(sdkScript));
    gateway.post('/__test/capture', express.json({ limit: '2kb' }), (req, res) => {
      if (req.headers.origin !== fixtureOrigin) { res.status(403).json({ error: 'Local test origin required.' }); return; }
      try { validateControlledOrderRequest(req.headers.origin, req.body); }
      catch { res.status(400).json({ error: 'One local test order ID is required.' }); return; }
      try { res.json(localProvider.capture(req.body.orderId)); }
      catch { res.status(404).json({ error: 'Local test order not found.' }); }
    });
    const replayedOrders = new Set();
    for (const action of ['recover', 'replay']) gateway.post(`/__test/${action}`, express.json({ limit: '2kb' }), async (req, res) => {
      if (req.headers.origin !== fixtureOrigin) { res.status(403).json({ error: 'Local test origin required.' }); return; }
      let orderId;
      try { orderId = validateControlledOrderRequest(req.headers.origin, req.body); }
      catch { res.status(400).json({ error: 'One local test order ID is required.' }); return; }
      if (action === 'replay' && !replayedOrders.has(orderId)) { res.status(409).json({ error: 'Recover the signed event before replay.' }); return; }
      let event;
      try { event = localProvider.capturedWebhook(orderId); }
      catch { res.status(404).json({ error: 'Local captured order not found.' }); return; }
      // Raw bytes and private signature remain server-side. The real app's raw
      // webhook middleware, parser, digest deduplication and gateway fulfill it.
      const response = await fetch(`${fixtureOrigin}/api/webhooks/razorpay`, { method: 'POST', body: event.raw,
        headers: { 'content-type': 'application/json', 'X-Razorpay-Signature': event.signature, 'X-Razorpay-Event-Id': event.eventId } });
      if (!response.ok) { res.status(502).json({ error: 'Real webhook processing failed.' }); return; }
      replayedOrders.add(orderId); res.json({ localTest: true, received: true, eventId: event.eventId, replay: action === 'replay' });
    });
    // Keep /api path intact so the real app handles every middleware/controller.
    gateway.use((req, res, next) => req.path === '/api' || req.path.startsWith('/api/') ? api(req, res, next) : next());
    gateway.use(express.static(frontendDist, { index: false, fallthrough: true }));
    gateway.get('/{*path}', (_req, res) => res.type('html').send(servedHtml));
    phase = 'listen';
    server = await new Promise((done, reject) => { const listener = gateway.listen(fixturePort, '127.0.0.1', () => done(listener)); listener.once('error', reject); });
    const stop = () => { void close().then(() => process.exit(0), () => process.exit(1)); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    console.info(JSON.stringify({ event: 'ui_test_browser_ready', localTest: true, port: fixturePort, fixtureIds,
      accounts: context.accounts, bookedSeat: 'A1', heldSeat: 'A2', availableSeats: ['A3', 'A4'] }));
    return { server, close, context };
  } catch (error) {
    await close();
    if (error instanceof Error) error.fixtureStage = phase;
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void startUiBrowserFixture().catch(error => {
    // Configuration URLs, hashes, generated signing credentials and database
    // exception text are deliberately absent from startup diagnostics.
    console.error(JSON.stringify({ event: 'ui_test_browser_start_failed', phase: error.fixtureStage ?? 'configuration_or_build',
      code: typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : undefined,
      message: 'Check loopback test targets, fresh migrated database, Redis15, frontend/backend builds and unused port 55440.' }));
    process.exitCode = 1;
  });
}
