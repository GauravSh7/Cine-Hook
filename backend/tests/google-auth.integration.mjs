import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { createApp } from '../dist/app.js';
import { createPrisma } from '../dist/lib/prisma.js';
import { createCatalog } from '../dist/modules/catalog/create-catalog.js';
import { HealthService } from '../dist/modules/health/health.service.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { UserRepository } from '../dist/modules/auth/user.repository.js';
import { TokenService } from '../dist/modules/auth/token.service.js';
import { GoogleUserRepository } from '../dist/modules/auth/google/google.repository.js';
import { GoogleAuthService } from '../dist/modules/auth/google/google.service.js';
import { GoogleChallenge } from '../dist/modules/auth/google/google.challenge.js';

const url = process.env.GOOGLE_AUTH_TEST_DATABASE_URL;
test('PostgreSQL: Google subject race and email collision (controlled verifier boundary)', { skip: !url, timeout: 20000 }, async () => {
  const target = new URL(url); assert.match(target.pathname, /_test$/); assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  const prisma = createPrisma(url), run = randomUUID(), email = `google-${run}@example.com`, collisionEmail = `collision-${run}@example.com`, sub = run;
  const clientId = '123-test.apps.googleusercontent.com', origin = 'http://localhost:5173', secret = 'integration-only-google-key-123456789012345';
  const tokens = new TokenService({ secret, expiresInSeconds: 3600 });
  const app = createApp({ frontendOrigin: origin, catalog: createCatalog(prisma), healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }),
    auth: { service: new AuthService(new UserRepository(prisma), tokens), tokens, google: {
      challenge: new GoogleChallenge({ secret, clientId, origin, secure: false }),
      service: new GoogleAuthService(new GoogleUserRepository(prisma), { verify: async credential => JSON.parse(credential) }, tokens, clientId),
    } } });
  async function login(subject, address) {
    const challenge = await request(app).post('/api/auth/google/challenge').set('Origin', origin).send({}); assert.equal(challenge.status, 200);
    const now = Math.floor(Date.now() / 1000);
    return request(app).post('/api/auth/google').set('Origin', origin).set('Cookie', challenge.headers['set-cookie'][0].split(';')[0]).send({ csrfToken: challenge.body.data.csrfToken,
      credential: JSON.stringify({ sub: subject, email: address, email_verified: true, name: 'Integration Google', nonce: challenge.body.data.nonce, aud: clientId, iss: 'https://accounts.google.com', iat: now, exp: now + 3600 }) });
  }
  try {
    const race = await Promise.all([login(sub, email), login(sub, email)]); assert.deepEqual(race.map(r => r.status), [200, 200]); assert.equal(race[0].body.data.user.id, race[1].body.data.user.id);
    const stored = await prisma.user.findUniqueOrThrow({ where: { googleSubject: sub } }); assert.equal(stored.passwordHash, null); assert.equal(stored.role, 'USER');
    const passwordLogin = await request(app).post('/api/auth/login').send({ email, password: 'integration-password' }); assert.equal(passwordLogin.status, 401);
    const password='integration-link-password', passwordHash=await bcrypt.hash(password,4);
    const existing=await prisma.user.create({ data: { name: 'Existing Admin', email: collisionEmail, role: 'ADMIN', passwordHash } });
    const collision = await login(`${sub}-other`, collisionEmail); assert.equal(collision.status, 409); assert.equal(collision.body.error.code, 'GOOGLE_EMAIL_CONFLICT'); assert.ok(!collision.body.data);
    async function link(subject,proof=password) {
      const challenge=await request(app).post('/api/auth/google/challenge').set('Origin',origin).send({});
      const now=Math.floor(Date.now()/1000);
      return request(app).post('/api/auth/google/link').set('Authorization',`Bearer ${tokens.sign({userId:existing.id,role:'ADMIN'})}`)
        .set('Origin',origin).set('Cookie',challenge.headers['set-cookie'][0].split(';')[0]).send({password:proof,csrfToken:challenge.body.data.csrfToken,
          credential:JSON.stringify({sub:subject,email:collisionEmail,email_verified:true,nonce:challenge.body.data.nonce,aud:clientId,iss:'https://accounts.google.com',iat:now,exp:now+3600})});
    }
    assert.equal((await link(`${sub}-other`,'wrong-password')).status,403);
    const linked=await Promise.all([link(`${sub}-other`),link(`${sub}-different`)]);
    assert.deepEqual(linked.map(r=>r.status).sort(),[200,409]);
    const preserved=await prisma.user.findUniqueOrThrow({where:{id:existing.id}});
    assert.equal(preserved.passwordHash,passwordHash);assert.equal(preserved.role,'ADMIN');assert.equal(preserved.name,'Existing Admin');
    assert.equal((await login(preserved.googleSubject,collisionEmail)).body.data.user.id,existing.id);
    assert.equal((await link(preserved.googleSubject)).status,200);
    assert.equal(await prisma.user.count({where:{email:collisionEmail}}),1);
  } finally { try { await prisma.user.deleteMany({ where: { email: { in: [email, collisionEmail] } } }); } finally { await prisma.$disconnect(); } }
});
