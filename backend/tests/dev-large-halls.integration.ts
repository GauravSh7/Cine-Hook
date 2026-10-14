import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedLargeHalls } from '../prisma/dev-large-halls-core.js';

const url = process.env.LARGE_HALL_TEST_DATABASE_URL;
test('large hall additions preserve inventory, reuse parent prices and are idempotent under an IST pool', { skip: !url }, async () => {
  const target = new URL(url!);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55438'); assert.equal(target.username, 'cinehook_verify');
  assert.match(target.pathname, /^\/cinehook_large_halls_[a-z0-9_]+_test$/);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: '-c timezone=Asia/Kolkata' }) });
  const reader = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: '-c timezone=UTC' }) });
  const options = { expectedDatabase: target.pathname.slice(1), expectedPort: 55438, now: new Date('2099-10-10T00:00:00Z') };
  const snapshot = async () => Promise.all(['movies','cities','theatres','screens','seats','shows','show_seat_prices','bookings'].map(table => prisma.$queryRawUnsafe(`SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS rows FROM ${table} t`)));
  try {
    assert.equal(await prisma.screen.count(), 0, 'Only a newly created isolated test database is accepted.');
    await assert.rejects(seedLargeHalls(prisma, { ...options, expectedDatabase: 'cinehook_large_halls_wrong_test' }), /identity/);
    const films = await Promise.all(['Deadpool & Wolverine','Salaar: Part 1 – Ceasefire'].map((title, i) => prisma.movie.create({ data: { title, durationMinutes: i ? 175 : 128, language: 'english', genres: ['action'], releaseDate: new Date('2024-01-01Z'), description: 'test' } })));
    for (const [i,name] of ['Mumbai','Bengaluru'].entries()) {
      const city = await prisma.city.create({ data: { name, state: name, countryCode: 'IN' } });
      const theatre = await prisma.theatre.create({ data: { name: `CineHook Demo ${name}`, cityId: city.id, address: 'test' } });
      const screen = await prisma.screen.create({ data: { name: 'Preserved screen', capacity: 3, theatreId: theatre.id, seats: { create: (['REGULAR','PREMIUM','RECLINER'] as const).map((seatType,j)=>({ id:randomUUID(),rowName:'A',seatNumber:j+1,seatType })) } } });
      for (const film of films) await prisma.show.create({ data: { movieId: film.id, screenId: screen.id, startsAt: new Date(film === films[0] ? '2099-10-01T12:30:00Z' : '2099-10-01T16:30:00Z'), endsAt: new Date(film === films[0] ? '2099-10-01T14:38:00Z' : '2099-10-01T19:25:00Z'), prices: { create: [{ seatType:'REGULAR',pricePaise:11000+i*1000 },{ seatType:'PREMIUM',pricePaise:22000+i*1000 },{ seatType:'RECLINER',pricePaise:33000+i*1000 }] } } });
    }
    const oldScreens=await reader.screen.findMany({orderBy:{id:'asc'}});
    const oldSeats=await reader.seat.findMany({orderBy:{id:'asc'}});
    const oldShows=await reader.show.findMany({include:{prices:true},orderBy:{id:'asc'}});
    const original = await snapshot();
    assert.deepEqual((await seedLargeHalls(prisma, options)).created, { screens:2,seats:288,shows:16,prices:48 });
    const after = await snapshot();
    for (const index of [0,1,2,7]) assert.deepEqual(after[index], original[index]);
    assert.deepEqual(await reader.screen.findMany({where:{id:{in:oldScreens.map(s=>s.id)}},orderBy:{id:'asc'}}),oldScreens);
    assert.deepEqual(await reader.seat.findMany({where:{id:{in:oldSeats.map(s=>s.id)}},orderBy:{id:'asc'}}),oldSeats);
    assert.deepEqual(await reader.show.findMany({where:{id:{in:oldShows.map(s=>s.id)}},include:{prices:true},orderBy:{id:'asc'}}),oldShows);
    assert.deepEqual((await seedLargeHalls(prisma, options)).created, { screens:0,seats:0,shows:0,prices:0 });
    assert.deepEqual(await snapshot(), after);
    const halls = await reader.screen.findMany({ where:{ name:'Grand Screen 144' },include:{ seats:true,shows:{ include:{ movie:true,prices:true } },theatre:{ include:{ city:true } } } });
    for (const hall of halls) {
      assert.equal(hall.seats.length,144); assert.equal(hall.shows.length,8);
      for (const show of hall.shows) {
        assert.equal(show.endsAt.getTime()-show.startsAt.getTime(),show.movie.durationMinutes*60000);
        assert.ok(['12:30','16:30'].includes(show.startsAt.toISOString().slice(11,16)));
        const offset=hall.theatre.city.name==='Mumbai'?0:1000;
        assert.deepEqual(show.prices.map(p=>p.pricePaise).sort((a,b)=>a-b),[11000+offset,22000+offset,33000+offset]);
      }
    }
  } finally { await reader.$disconnect(); await prisma.$disconnect(); }
});
