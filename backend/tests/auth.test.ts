import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { AppError } from '../src/errors/app-error.js';
import { HealthService } from '../src/modules/health/health.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import type { UserStore, StoredUser, PublicUser } from '../src/modules/auth/auth.types.js';
import { testCatalog } from './helpers/catalog.js';

const secret = 'test-only-signing-key-not-used-outside-tests-12345';
const options = { secret, expiresInSeconds: 3600 };
const credentials = { name: 'Gaurav', email: 'gaurav@example.com', password: 'a-secure-password' };
let fixtureHash: string;
beforeAll(async () => { fixtureHash = await bcrypt.hash(credentials.password, 12); });

// Only the external database is substituted. Real routes, validation,
// controllers, auth service, bcrypt, token signing and middleware run in tests.
class TestUsers implements UserStore {
  records = new Map<string, StoredUser>();
  failCreate = false;
  async create(input: { name: string; email: string; passwordHash: string }): Promise<PublicUser> {
    if (this.failCreate || [...this.records.values()].some(u => u.email === input.email)) {
      throw new AppError(409, 'EMAIL_EXISTS', 'Email is already registered.');
    }
    const user: StoredUser = { ...input, id: randomUUID(), role: 'USER', createdAt: new Date(), updatedAt: new Date() };
    this.records.set(user.id, user);
    const { passwordHash: _hash, ...safe } = user;
    return safe;
  }
  async findByEmail(email: string) { return [...this.records.values()].find(u => u.email === email) ?? null; }
  async findById(id: string): Promise<PublicUser | null> {
    const user = this.records.get(id);
    if (!user) return null;
    const { passwordHash: _hash, ...safe } = user;
    return safe;
  }
}

function setup(seed = false) {
  const users = new TestUsers();
  const id = randomUUID();
  if (seed) users.records.set(id, { id, name: credentials.name, email: credentials.email,
    passwordHash: fixtureHash, role: 'USER', emailVerifiedAt: new Date(), authVersion: 0, authDisabledAt: null, createdAt: new Date(), updatedAt: new Date() });
  const tokens = new TokenService(options);
  const app = createApp({ frontendOrigin: 'http://localhost:5173',
    catalog: testCatalog().services,
    healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }),
    auth: { service: new AuthService(users, tokens), tokens },
  });
  return { app, users, tokens, id };
}

describe('public registration', () => {
  it('refuses account creation before verified registration proof and returns no credentials', async () => {
    const { app, users } = setup();
    const response = await request(app).post('/api/auth/register').send(credentials);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(response.body).not.toHaveProperty('data');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(users.records.size).toBe(0);
  });
  it('does not disclose an existing normalized email before ownership proof', async () => {
    const { app } = setup(true);
    const response = await request(app).post('/api/auth/register').send({ ...credentials, email: ' GAURAV@EXAMPLE.COM ' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
  });
  it('never reaches database creation without a configured proof service', async () => {
    const { app, users } = setup();
    users.failCreate = true;
    const response = await request(app).post('/api/auth/register').send({...credentials,registrationToken:'x'.repeat(43)});
    expect(response.status).toBe(403);expect(users.records.size).toBe(0);
  });
  it.each([
    { name: '', email: credentials.email, password: credentials.password },
    { ...credentials, email: 'invalid' },
    { ...credentials, password: 'short' },
    { ...credentials, password: 'x'.repeat(73) },
    { ...credentials, password: '😀'.repeat(19) },
    { ...credentials, password: '😀'.repeat(4) },
    { ...credentials, role: 'ADMIN' },
    { ...credentials, userId: randomUUID() },
    { ...credentials, password: 'abcd\u0000efgh' },
  ])('rejects invalid input and privilege injection', async body => {
    const { app, users } = setup();
    const response = await request(app).post('/api/auth/register').send(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(users.records.size).toBe(0);
    expect(response.body.error).not.toHaveProperty('issues');
  });
});

describe('login and protected profile', () => {
  it('logs in publicly using a normalized email and fetches /me', async () => {
    const { app, id } = setup(true);
    const login = await request(app).post('/api/auth/login').send({ email: ' GAURAV@EXAMPLE.COM ', password: credentials.password });
    expect(login.status).toBe(200);
    expect(login.body.data.user.id).toBe(id);
    expect(login.body.data.user).not.toHaveProperty('passwordHash');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe(id);
    expect(me.body.data.user).not.toHaveProperty('passwordHash');
  });
  it('gives the same safe error for a wrong password and unknown email', async () => {
    const { app } = setup(true);
    const wrong = await request(app).post('/api/auth/login').send({ email: credentials.email, password: 'wrong-password' });
    const absent = await request(app).post('/api/auth/login').send({ email: 'absent@example.com', password: credentials.password });
    expect(wrong.status).toBe(401);
    expect(absent.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(absent.body.error.message).toBe(wrong.body.error.message);
    expect(wrong.text).not.toContain(credentials.password);
  });
  it('rejects malformed login input', async () => {
    const { app } = setup();
    const response = await request(app).post('/api/auth/login').send({ email: credentials.email });
    expect(response.status).toBe(400);
  });
  it.each([undefined, 'Basic abc', 'Bearer', 'Bearer a.b.c', 'Bearer abc extra'])('rejects missing or malformed authorization', async header => {
    const { app } = setup(true);
    const req = request(app).get('/api/auth/me');
    if (header) req.set('Authorization', header);
    const response = await req;
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
  it.each(['expired', 'wrong-signature', 'wrong-algorithm', 'wrong-issuer', 'wrong-audience', 'missing-expiry', 'wrong-role', 'bad-user-id'])('rejects %s JWT', async kind => {
    const { app, id } = setup(true);
    const payload: jwt.JwtPayload = { userId: id, role: 'USER' };
    const signing: jwt.SignOptions = { algorithm: 'HS256', issuer: 'cinehook', audience: 'cinehook-api', expiresIn: 3600 };
    if (kind === 'expired') signing.expiresIn = -1;
    if (kind === 'wrong-algorithm') signing.algorithm = 'HS384';
    if (kind === 'wrong-issuer') signing.issuer = 'other';
    if (kind === 'wrong-audience') signing.audience = 'other';
    if (kind === 'missing-expiry') delete signing.expiresIn;
    if (kind === 'wrong-role') payload.role = 'SUPERADMIN';
    if (kind === 'bad-user-id') payload.userId = 'not-a-uuid';
    const token = jwt.sign(payload, kind === 'wrong-signature' ? 'other-signing-secret-123456789012345' : secret, signing);
    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(response.text).not.toContain(token);
  });
  it('rejects a valid JWT after the user is deleted', async () => {
    const { app, tokens, id } = setup(true);
    const token = tokens.sign({ userId: id, role: 'USER' });
    // Separate request after deletion must query the database again.
    const second = setup();
    const response = await request(second.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });
  it('returns current database role instead of stale token role', async () => {
    const { app, tokens, users, id } = setup(true);
    const token = tokens.sign({ userId: id, role: 'USER' });
    users.records.get(id)!.role = 'ADMIN';
    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe('ADMIN');
  });
  it('issues an ADMIN identity only for an existing database ADMIN', async () => {
    const { app, users, id } = setup(true);
    users.records.get(id)!.role = 'ADMIN';
    const response = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password });
    expect(response.status).toBe(200);
    expect((jwt.verify(response.body.data.accessToken, secret) as jwt.JwtPayload).role).toBe('ADMIN');
  });
});
