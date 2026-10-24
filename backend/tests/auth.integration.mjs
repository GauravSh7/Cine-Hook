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
import {createClient} from 'redis';
import {OwnershipRepository} from '../dist/modules/auth/ownership.repository.js';
import {OwnershipService} from '../dist/modules/auth/ownership.service.js';
import {OwnershipProofStore} from '../dist/modules/auth/ownership-proof.store.js';

const url = process.env.AUTH_TEST_DATABASE_URL;
test('PostgreSQL: OTP register/login/me and concurrent duplicate registration', { skip: !url || !process.env.SEAT_LOCK_TEST_REDIS_URL, timeout: 30000 }, async () => {
  // Writes require an explicitly supplied disposable test database.
  assert.match(new URL(url).pathname, /_test$/);
  const prisma = createPrisma(url);
  const run = randomUUID();
  const emails = [`auth-${run}@example.com`, `race-${run}@example.com`];
  const password = 'integration-only-password';
  const redis=createClient({url:process.env.SEAT_LOCK_TEST_REDIS_URL});await redis.connect();
  const secret='integration-only-key-not-a-real-secret-12345',repo=new OwnershipRepository(prisma),codes=new Map();
  const tokens = new TokenService({ secret, expiresInSeconds: 3600,currentAuth:id=>repo.authSnapshot(id) });
  const ownership=new OwnershipService(repo,new OwnershipProofStore(redis,secret),tokens,{secret,mailer:{sendVerificationCode:async(email,code)=>{codes.set(email,code);}}});
  const app = createApp({ frontendOrigin: 'http://localhost:5173',
    catalog: createCatalog(prisma),
    healthService: new HealthService({ checkDatabase: async () => { await prisma.$queryRaw`SELECT 1`; }, checkRedis: async () => {} }),
    auth: { service: new AuthService(new UserRepository(prisma), tokens,ownership), tokens,ownership },
  });
  async function proof(email){const a=await request(app).post('/api/auth/ownership/request').send({purpose:'REGISTER',email});assert.equal(a.status,200);
    const b=await request(app).post('/api/auth/ownership/verify').send({challengeId:a.body.data.challengeId,otp:codes.get(email)});assert.equal(b.status,200);return b.body.data.token;}
  try {
    assert.equal((await request(app).post('/api/auth/register').send({name:'Unverified',email:emails[0],password})).status,403);
    const registered = await request(app).post('/api/auth/register').send({ name: 'Integration', email: emails[0], password, phone: '+919876543210',registrationToken:await proof(emails[0]) });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.data.user.role, 'USER');
    assert.ok(!('passwordHash' in registered.body.data.user));
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } });
    assert.notEqual(stored.passwordHash, password);
    assert.equal(stored.phone, '+919876543210');
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
    const grants=[await proof(emails[1]),await proof(emails[1])];
    const race = await Promise.all(grants.map(registrationToken => request(app).post('/api/auth/register')
      .send({ name: 'Race', email: emails[1], password,registrationToken })));
    assert.deepEqual(race.map(response => response.status).sort(), [201, 409]);
    assert.equal(await prisma.user.count({ where: { email: emails[1] } }), 1);
    await prisma.user.update({ where: { id: stored.id }, data: { role: 'ADMIN' } });
    const current = await request(app).get('/api/auth/me').set('Authorization', header);
    assert.equal(current.body.data.user.role, 'ADMIN');
    const signedOut=await request(app).post('/api/auth/logout').set('Authorization',header).send({});
    assert.equal(signedOut.status,200);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:stored.id}})).authVersion,stored.authVersion+1);
    assert.equal((await request(app).get('/api/auth/me').set('Authorization',header)).status,401);
    const fresh=await request(app).post('/api/auth/login').send({email:emails[0],password});
    assert.equal(fresh.status,200);
    assert.equal((await request(app).get('/api/auth/me').set('Authorization',`Bearer ${fresh.body.data.accessToken}`)).status,200);
    await prisma.user.delete({ where: { id: stored.id } });
    const deleted = await request(app).get('/api/auth/me').set('Authorization', header);
    assert.equal(deleted.status, 401);
  } finally {
    try { await prisma.user.deleteMany({ where: { email: { in: emails } } }); }
    finally { await prisma.$disconnect();await redis.quit(); }
  }
});
