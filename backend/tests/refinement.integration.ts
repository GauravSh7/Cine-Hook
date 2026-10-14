import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedDevelopment } from '../prisma/dev-seed-core.js';
import { seedRefinementContent } from '../prisma/refinement-seed-core.js';
import { FILMS, seedId } from '../prisma/dev-seed-manifest.js';
import { DEMO_LISTINGS } from '../prisma/refinement-manifest.js';
import { DemoCatalogService } from '../src/modules/demo-catalog/demo-catalog.service.js';
import { DemoCatalogRepository } from '../src/modules/demo-catalog/demo-catalog.repository.js';

const url = process.env.REFINEMENT_TEST_DATABASE_URL;
test('native refinement seed preserves custom data, is idempotent/concurrent, and catalogue reads remain non-bookable', { skip: !url, timeout: 120000 }, async () => {
  const parsed = new URL(url!); assert.match(parsed.pathname, /^\/[a-z0-9_]+_test$/); assert.equal(parsed.hostname, '127.0.0.1'); assert.equal(parsed.search, '');
  const options = { expectedDatabase: parsed.pathname.slice(1), expectedPort: Number(parsed.port), now: new Date('2099-10-10T00:00:00Z') };
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    assert.equal(await prisma.movie.count(), 0, 'Provide a fresh isolated test database.');
    await seedDevelopment(prisma, { ...options, password: 'NativeRefinementTest1!' });
    const originalUsers = await prisma.user.findMany();
    const originalShows = await prisma.show.findMany();
    const customId = seedId(`movie:${FILMS[0]!.key}`);
    await prisma.movie.update({ where: { id: customId }, data: { descriptionHindi: 'मेरे अपने शब्द', posterUrl: 'https://example.invalid/custom.jpg', artworkKind: null, artworkAttribution: null, artworkSourceUrl: null } });
    const first = await seedRefinementContent(prisma, options);
    assert.deepEqual(first.created, { STREAM: 6, EVENTS: 6, SPORTS: 6, ACTIVITIES: 6 }); assert.equal(first.enriched.hindi, 29);
    assert.equal(await prisma.movie.count(), 30); assert.equal((await prisma.movie.findUniqueOrThrow({ where: { id: customId } })).descriptionHindi, 'मेरे अपने शब्द');
    assert.equal((await prisma.movie.findUniqueOrThrow({ where: { id: customId } })).posterUrl, 'https://example.invalid/custom.jpg');
    const modified = await prisma.demoListing.update({ where: { slug: DEMO_LISTINGS[0]!.slug }, data: { title: 'Custom demo title', imageUrl: '/custom-approved.svg' } });
    const before = await prisma.demoListing.findMany({ orderBy: { slug: 'asc' } });
    const second = await seedRefinementContent(prisma, options);
    assert.deepEqual(second, { created: { STREAM: 0, EVENTS: 0, SPORTS: 0, ACTIVITIES: 0 }, enriched: { hindi: 0 } });
    await Promise.all([seedRefinementContent(prisma, options), seedRefinementContent(prisma, options)]);
    assert.deepEqual(await prisma.demoListing.findMany({ orderBy: { slug: 'asc' } }), before);
    assert.deepEqual(await prisma.user.findMany(), originalUsers); assert.deepEqual(await prisma.show.findMany(), originalShows);
    const service = new DemoCatalogService(new DemoCatalogRepository(prisma));
    const all = await service.list({ kind: 'EVENTS', page: 1, limit: 20 });
    assert.equal(all.items.length, 6); assert.ok(all.items.every(row => row.isDemo === true && row.bookingAvailable === false));
    assert.ok(all.items.every(row => row.startsAt! > options.now));
    const filtered = await service.list({ kind: 'EVENTS', category: 'Concerts', search: 'Skyline', page: 1, limit: 20 });
    assert.equal(filtered.items.length, 1); assert.equal(filtered.items[0]!.slug, 'demo-skyline-sessions');
    const opened = await service.get('EVENTS', filtered.items[0]!.id);
    assert.equal(opened.listing.id, filtered.items[0]!.id); assert.equal(opened.listing.bookingAvailable, false);
    assert.ok(!('isActive' in opened.listing)); assert.ok(!('createdAt' in opened.listing));
    await assert.rejects(service.get('SPORTS', opened.listing.id), { code: 'LISTING_NOT_FOUND' });
    for (const city of await prisma.city.findMany()) {
      for (const kind of ['EVENTS', 'SPORTS', 'ACTIVITIES'] as const) {
        const inCity = await service.list({ kind, cityId: city.id, page: 1, limit: 20 });
        assert.equal(inCity.items.length, 2); assert.ok(inCity.items.every(item => item.cityName?.toLowerCase() === city.name.toLowerCase()));
      }
      assert.equal((await service.list({ kind: 'STREAM', cityId: city.id, page: 1, limit: 20 })).items.length, 6);
    }
    await assert.rejects(service.list({ kind: 'SPORTS', cityId: seedId('missing-city'), page: 1, limit: 20 }), { code: 'CITY_NOT_FOUND' });
    assert.equal((await service.list({ kind: 'EVENTS', search: '%', page: 1, limit: 20 })).items.length, 0);
    await prisma.demoListing.update({ where: { id: filtered.items[0]!.id }, data: { isActive: false } });
    assert.equal((await service.list({ kind: 'EVENTS', search: 'Skyline', page: 1, limit: 20 })).items.length, 0);
    await assert.rejects(service.get('EVENTS', opened.listing.id), { code: 'LISTING_NOT_FOUND' });
    // Identity collision must abort instead of overwriting a user's row or unrelated metadata.
    await prisma.demoListing.update({ where: { id: modified.id }, data: { slug: 'user-reserved-slug' } });
    const collided = await prisma.demoListing.findMany({ orderBy: { id: 'asc' } });
    await assert.rejects(seedRefinementContent(prisma, options), /identity collision/);
    assert.deepEqual(await prisma.demoListing.findMany({ orderBy: { id: 'asc' } }), collided);
  } finally { await prisma.$disconnect(); }
});
test('native SQL rejects incomplete or unsafe trailer evidence without changing movie metadata', { skip: !url }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const movie = await prisma.movie.findFirstOrThrow();
    await assert.rejects(prisma.movie.update({ where: { id: movie.id }, data: { trailerVideoId: 'TestOnlyID1' } }));
    await assert.rejects(prisma.movie.update({ where: { id: movie.id }, data: { trailerVideoId: '../unsafe', trailerSourceUrl: 'https://www.themoviedb.org/movie/1', trailerVerifiedAt: new Date() } }));
    assert.deepEqual(await prisma.movie.findUniqueOrThrow({ where: { id: movie.id } }), movie);
  } finally { await prisma.$disconnect(); }
});
