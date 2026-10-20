import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createPrisma } from '../src/lib/prisma.ts';
import { OwnershipRepository } from '../src/modules/auth/ownership.repository.ts';

const url = process.env.OWNERSHIP_REPOSITORY_TEST_DATABASE_URL;
test('clean start quarantines credentials, preserves private history and serializes email reclamation', { skip: !url }, async () => {
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55448');
  assert.equal(target.pathname, '/cinehook_ownership_migration_test');
  const prisma = createPrisma(url), repo = new OwnershipRepository(prisma);
  try {
    const original = await prisma.user.create({ data: { name: 'Attacker private name', email: `${randomUUID()}@example.test`, role: 'ADMIN', passwordHash: 'old-hash', phone: 'private-phone' } });
    const movie = await prisma.movie.create({ data: { title: 'Private wishlist fixture', description: 'fixture', durationMinutes: 120, releaseDate: new Date('2026-01-01'), language: 'hindi', genres: ['drama'] } });
    const wishlist = await prisma.movieWishlist.create({ data: { userId: original.id, movieId: movie.id } });
    const results = await Promise.allSettled([repo.cleanStart(original, { name: 'Owner', passwordHash: 'new-hash' }), repo.cleanStart(original, { name: 'Racer', passwordHash: 'racing-hash' })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const replacement = results.find(r => r.status === 'fulfilled').value;
    assert.notEqual(replacement.id, original.id); assert.equal(replacement.email, original.email);
    assert.equal(replacement.role, 'USER'); assert.equal(replacement.phone, null);
    assert.equal(await prisma.movieWishlist.count({ where: { userId: replacement.id } }), 0);
    const old = await prisma.user.findUniqueOrThrow({ where: { id: original.id } });
    assert.ok(old.authDisabledAt); assert.equal(old.authVersion, 1); assert.equal(old.passwordHash, null);
    assert.match(old.email, /@quarantined\.invalid$/);
    assert.equal((await prisma.movieWishlist.findUniqueOrThrow({ where: { userId_movieId: { userId: wishlist.userId, movieId: wishlist.movieId } } })).userId, original.id);
    assert.equal(await prisma.accountQuarantine.count({ where: { originalUserId: original.id, replacementUserId: replacement.id } }), 1);
    assert.ok(replacement.emailVerifiedAt);
    const linked = await prisma.user.create({ data: { name: 'Google', email: `${randomUUID()}@example.test`, googleSubject: randomUUID(), passwordHash: 'old' } });
    await assert.rejects(repo.cleanStart({ ...linked, googleSubject: null }, { name: 'Claimant', passwordHash: 'new' }), { code: 'OWNERSHIP_CONFLICT' });
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: linked.id } })).googleSubject, linked.googleSubject);
    const established = await repo.verifyLegacy(linked, 'fresh-owner-hash');
    assert.equal(established.id, linked.id); assert.equal(established.authVersion, 1);
    assert.ok(established.emailVerifiedAt);
    await assert.rejects(repo.verifyLegacy(linked, 'stale-hash'), { code: 'OWNERSHIP_CONFLICT' });
    const reset = await repo.resetVerified(await prisma.user.findUniqueOrThrow({ where: { id: linked.id } }), 'next-hash');
    assert.equal(reset.authVersion, 2); assert.equal(reset.id, linked.id);
  } finally { await prisma.$disconnect(); }
});
