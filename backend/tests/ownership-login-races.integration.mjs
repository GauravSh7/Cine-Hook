import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import bcrypt from 'bcrypt';
import { createPrisma } from '../src/lib/prisma.ts';
import { OwnershipRepository } from '../src/modules/auth/ownership.repository.ts';
import { UserRepository } from '../src/modules/auth/user.repository.ts';
import { GoogleUserRepository } from '../src/modules/auth/google/google.repository.ts';
import { AuthService } from '../src/modules/auth/auth.service.ts';
import { TokenService } from '../src/modules/auth/token.service.ts';
const url = process.env.OWNERSHIP_REPOSITORY_TEST_DATABASE_URL;
test('in-flight password login cannot issue a usable old-password session after reset or linking commits', { skip: !url }, async () => {
  assert.equal(new URL(url).host, '127.0.0.1:55448'); assert.equal(new URL(url).pathname, '/cinehook_ownership_migration_test');
  const prisma = createPrisma(url), ownership = new OwnershipRepository(prisma), users = new UserRepository(prisma), google = new GoogleUserRepository(prisma);
  const tokens = new TokenService({ secret: 'isolated-stale-login-version-key-123456789012345', expiresInSeconds: 600, currentAuth: id => ownership.authSnapshot(id) });
  try {
    for (const transition of ['RESET', 'LINK']) {
      const password = 'known-before-transition';
      const original = await prisma.user.create({ data: { name: 'Race owner', email: `${randomUUID()}@example.test`, passwordHash: await bcrypt.hash(password, 4), emailVerifiedAt: new Date() } });
      let read, resume;
      const didRead = new Promise(resolve => { read = resolve; }), gate = new Promise(resolve => { resume = resolve; });
      const auth = new AuthService({ create: input => users.create(input), findById: id => users.findById(id),
        findByEmail: async email => { const snapshot = await users.findByEmail(email); read(); await gate; return snapshot; } }, tokens);
      const inFlight = auth.login({ email: original.email, password });
      await didRead;
      try {
        if (transition === 'RESET') await ownership.resetVerified(original, await bcrypt.hash('recovered-password', 4));
        else await google.linkGoogle({ userId: original.id, email: original.email, passwordHash: original.passwordHash, authVersion: 0, googleSubject: randomUUID() });
      } finally { resume(); }
      const result = await inFlight;
      await assert.rejects(tokens.verifySession(result.accessToken), { code: 'UNAUTHORIZED' });
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: original.id } })).authVersion, 1);
    }
  } finally { await prisma.$disconnect(); }
});
