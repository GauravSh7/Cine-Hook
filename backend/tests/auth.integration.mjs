import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { createApp } from '../dist/app.js';
import { createPrisma } from '../dist/lib/prisma.js';
import { HealthService } from '../dist/modules/health/health.service.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { TokenService } from '../dist/modules/auth/token.service.js';
import { UserRepository } from '../dist/modules/auth/user.repository.js';
import { createCatalog } from '../dist/modules/catalog/create-catalog.js';

const url = process.env.AUTH_TEST_DATABASE_URL;
test('PostgreSQL: register/login/me and concurrent duplicate registration', { skip: !url, timeout: 20000 }, async () => {
  // Writes require an explicitly supplied disposable test database.
  assert.match(new URL(url).pathname, /_test$/);
  const prisma = createPrisma(url);
  const run = randomUUID();
  const emails = [`auth-${run}@example.com`, `race-${run}@example.com`];
  const password = 'integration-only-password';
  const tokens = new TokenService({ secret: 'integration-only-key-not-a-real-secret-12345', expiresInSeconds: 3600 });
  const app = createApp({ frontendOrigin: 'http://localhost:5173',
    catalog: createCatalog(prisma),
    healthService: new HealthService({ checkDatabase: async () => { await prisma.$queryRaw`SELECT 1`; }, checkRedis: async () => {} }),
    auth: { service: new AuthService(new UserRepository(prisma), tokens), tokens },
  });
  try {
    const registered = await request(app).post('/api/auth/register').send({ name: 'Integration', email: emails[0], password });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.data.user.role, 'USER');
    assert.ok(!('passwordHash' in registered.body.data.user));
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } });
    assert.notEqual(stored.passwordHash, password);
    assert.equal(await bcrypt.compare(password, stored.passwordHash), true);
    const login = await request(app).post('/api/auth/login').send({ email: emails[0].toUpperCase(), password });
    assert.equal(login.status, 200);
    const header = `Bearer ${login.body.data.accessToken}`;
    const me = await request(app).get('/api/auth/me').set('Authorization', header);
    assert.equal(me.status, 200);
    assert.equal(me.body.data.user.id, stored.id);
    assert.ok(!('passwordHash' in me.body.data.user));
    const wrong = await request(app).post('/api/auth/login').send({ email: emails[0], password: 'wrong-password' });
    assert.equal(wrong.status, 401);
    const race = await Promise.all([0, 1].map(() => request(app).post('/api/auth/register')
      .send({ name: 'Race', email: emails[1], password })));
    assert.deepEqual(race.map(response => response.status).sort(), [201, 409]);
    assert.equal(await prisma.user.count({ where: { email: emails[1] } }), 1);
    await prisma.user.update({ where: { id: stored.id }, data: { role: 'ADMIN' } });
    const current = await request(app).get('/api/auth/me').set('Authorization', header);
    assert.equal(current.body.data.user.role, 'ADMIN');
    await prisma.user.delete({ where: { id: stored.id } });
    const deleted = await request(app).get('/api/auth/me').set('Authorization', header);
    assert.equal(deleted.status, 401);
  } finally {
    try { await prisma.user.deleteMany({ where: { email: { in: emails } } }); }
    finally { await prisma.$disconnect(); }
  }
});
