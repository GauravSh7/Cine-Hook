import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createPrisma } from '../src/lib/prisma.ts';
import { OwnershipRepository } from '../src/modules/auth/ownership.repository.ts';
import { GoogleUserRepository } from '../src/modules/auth/google/google.repository.ts';
const url = process.env.OWNERSHIP_REPOSITORY_TEST_DATABASE_URL;
test('ownership transitions serialize clean-start versus continuity and linking versus recovery', { skip: !url }, async () => {
  assert.equal(new URL(url).host, '127.0.0.1:55448'); assert.equal(new URL(url).pathname, '/cinehook_ownership_migration_test');
  const prisma = createPrisma(url), repo = new OwnershipRepository(prisma), google = new GoogleUserRepository(prisma);
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const old = await prisma.user.create({ data: { name: 'Race owner', email: `${randomUUID()}@example.test`, passwordHash: 'old' } });
      const race = await Promise.allSettled([repo.cleanStart(old, { name: 'Clean owner', passwordHash: 'replacement' }), repo.verifyLegacy(old, 'verified-owner')]);
      assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(await prisma.user.count({ where: { email: old.email } }), 1);
      const current = await prisma.user.findUniqueOrThrow({ where: { id: old.id } });
      assert.equal(current.authVersion, 1);
      assert.ok(current.authDisabledAt ? current.passwordHash === null : current.passwordHash === 'verified-owner');
      const verified = await prisma.user.create({ data: { name: 'Link owner', email: `${randomUUID()}@example.test`, passwordHash: 'known', emailVerifiedAt: new Date() } });
      const linkedSubject = randomUUID();
      const competed = await Promise.allSettled([google.linkGoogle({ userId: verified.id, email: verified.email, passwordHash: 'known', googleSubject: linkedSubject, authVersion: 0 }), repo.resetVerified(verified, 'reset-owner')]);
      assert.equal(competed.filter(r => r.status === 'fulfilled').length, 1);
      const final = await prisma.user.findUniqueOrThrow({ where: { id: verified.id } });
      assert.equal(final.authVersion, 1);
      assert.ok(final.googleSubject === linkedSubject ? final.passwordHash === 'known' : final.passwordHash === 'reset-owner');
    }
    const rollback = await prisma.user.create({ data: { name: 'Rollback owner', email: `${randomUUID()}@example.test`, passwordHash: 'old' } });
    // Real PostgreSQL failure after disabling the old user but before committing
    // provenance. The transaction must undo both user writes.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ownership_fixture_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.original_user_id='${rollback.id}'::uuid THEN RAISE EXCEPTION 'isolated provenance failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER ownership_fixture_reject BEFORE INSERT ON account_quarantines FOR EACH ROW EXECUTE FUNCTION ownership_fixture_reject()');
    try {
      await assert.rejects(repo.cleanStart(rollback, { name: 'Clean owner', passwordHash: 'new' }));
      assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: rollback.id } }), rollback);
      assert.equal(await prisma.user.count({ where: { email: rollback.email } }), 1);
      assert.equal(await prisma.accountQuarantine.count({ where: { originalUserId: rollback.id } }), 0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER ownership_fixture_reject ON account_quarantines');
      await prisma.$executeRawUnsafe('DROP FUNCTION ownership_fixture_reject()');
    }
  } finally { await prisma.$disconnect(); }
});
