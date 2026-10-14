import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { HealthService } from '../src/modules/health/health.service.js';
import { testCatalog } from './helpers/catalog.js';
import { parseConfig } from '../src/config/env.js';

const origin = 'http://localhost:5173';
const secret = 'google-test-only-strong-signing-secret-123456789';
const clientId = '123-test.apps.googleusercontent.com';
const tokens = new TokenService({ secret, expiresInSeconds: 3600 });
const base = () => createApp({ frontendOrigin: origin, healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }), catalog: testCatalog().services,
  auth: { service: new AuthService({ create: async () => { throw new Error(); }, findByEmail: async () => null, findById: async () => null }, tokens), tokens } });

it('reports missing Google configuration without exposing internal configuration', async () => {
  const response = await request(base()).get('/api/auth/google/config');
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual({ clientId: null });
  expect(response.headers['cache-control']).toContain('no-store');
});
it('rejects missing password hashes even if dummy timing work reports a match', async () => {
  const user = { id: randomUUID(), name: 'Google User', email: 'user@example.com', role: 'USER' as const, passwordHash: null, createdAt: new Date(), updatedAt: new Date() };
  const compare = vi.spyOn(bcrypt, 'compare').mockImplementation(async () => true);
  try {
    const service = new AuthService({ create: async () => user, findByEmail: async () => user, findById: async () => user }, tokens);
    await expect(service.login({ email: user.email, password: 'any-password' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  } finally { compare.mockRestore(); }
});
it('parses optional bounded Google and TMDB configuration', () => {
  const common = { DATABASE_URL: 'postgresql://test:test@localhost/cinehook_test', REDIS_URL: 'redis://localhost', FRONTEND_ORIGIN: origin, JWT_SECRET: secret };
  expect(parseConfig({ ...common, GOOGLE_CLIENT_ID: clientId }).googleClientId).toBe(clientId);
  expect(parseConfig({ ...common, GOOGLE_CLIENT_ID: '' }).googleClientId).toBeUndefined();
  expect(() => parseConfig({ ...common, GOOGLE_CLIENT_ID: 'bad-id' })).toThrow(/GOOGLE_CLIENT_ID/);
  expect(() => parseConfig({ ...common, TMDB_READ_ACCESS_TOKEN: 'x'.repeat(513) })).toThrow(/TMDB_READ_ACCESS_TOKEN/);
});

describe('Google authentication security and identity', () => {
  async function setup(configured = true, secure = false) {
    const { GoogleAuthService } = await import('../src/modules/auth/google/google.service.js');
    const { GoogleChallenge } = await import('../src/modules/auth/google/google.challenge.js');
    const records: Array<any> = [];
    const store = {
      findBySubject: async (subject: string) => records.find(u => u.googleSubject === subject) ?? null,
      findByEmail: async (email: string) => records.find(u => u.email === email) ?? null,
      createGoogle: async (input: any) => { const u = { ...input, id: randomUUID(), passwordHash: null, role: 'USER', createdAt: new Date(), updatedAt: new Date() }; records.push(u); return u; },
      linkGoogle: async (input:any)=>{const u=records.find(r=>r.id===input.userId);u.googleSubject=input.googleSubject;return u;},
      linkVerifiedGoogle: async (input:any)=>{const u=records.find(r=>r.id===input.userId && r.email===input.email && r.googleSubject===null);if(!u)throw new Error('link conflict');u.googleSubject=input.googleSubject;return u;},
    };
    const claims: any = { sub: '123456789012345678901', email: 'USER@example.com', email_verified: true, name: 'Google User', aud: clientId, iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), nonce: '' };
    let verificationCalls = 0;
    let rejection = false;
    const verifier = { verify: async () => { verificationCalls++; if (rejection) throw new Error('private-credential'); return claims; } };
    const challenge = new GoogleChallenge({ secret, clientId, origin, secure });
    const service = new GoogleAuthService(store, verifier, tokens, configured ? clientId : undefined);
    const app = createApp({ frontendOrigin: origin, healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }), catalog: testCatalog().services,
      auth: { service: new AuthService({ create: async () => { throw new Error(); }, findByEmail: store.findByEmail, findById: async id => records.find(r=>r.id===id)??null }, tokens), tokens, google: { service, challenge } } });
    async function begin() {
      const r = await request(app).post('/api/auth/google/challenge').set('Origin', origin).send({});
      expect(r.status).toBe(200); claims.nonce = r.body.data.nonce;
      return { body: { credential: 'test-provider-credential', csrfToken: r.body.data.csrfToken }, cookie: r.headers['set-cookie'][0].split(';')[0] as string, response: r };
    }
    const submit = (a: Awaited<ReturnType<typeof begin>>) => request(app).post('/api/auth/google').set('Origin', origin).set('Cookie', a.cookie).send(a.body);
    return { app, records, store, claims, begin, submit, calls: () => verificationCalls, reject: () => { rejection = true; } };
  }
  it('exposes only the client ID and refuses unconfigured challenge', async () => {
    const f = await setup(); expect((await request(f.app).get('/api/auth/google/config')).body.data).toEqual({ clientId });
    const off = await setup(false); const response = await request(off.app).post('/api/auth/google/challenge').set('Origin', origin).send({});
    expect(response.status).toBe(503); expect(off.calls()).toBe(0);
  });
  it('creates only USER with null hash and safely projects existing session format', async () => {
    const f = await setup(), a = await f.begin(), r = await f.submit(a);
    expect(r.status).toBe(200); expect(f.records[0]).toMatchObject({ email: 'user@example.com', role: 'USER', passwordHash: null, googleSubject: f.claims.sub });
    expect(r.body.data.user).not.toHaveProperty('googleSubject'); expect(r.body.data.user).not.toHaveProperty('passwordHash');
    expect(tokens.verify(r.body.data.accessToken)).toEqual({ userId: f.records[0].id, role: 'USER' });
    expect(r.headers['set-cookie'][0]).toContain('Max-Age=0');
  });
  it('returns identity by subject with current DB role and preserves stored metadata', async () => {
    const f = await setup(); f.records.push({ id: randomUUID(), googleSubject: f.claims.sub, email: 'old@example.com', name: 'Stored Name', role: 'ADMIN', passwordHash: 'private', createdAt: new Date(), updatedAt: new Date() });
    const r = await f.submit(await f.begin()); expect(r.status).toBe(200); expect(r.body.data.user).toMatchObject({ email: 'old@example.com', name: 'Stored Name', role: 'ADMIN' }); expect(f.records).toHaveLength(1);
  });
  it.each(['USER', 'ADMIN'])('does not link an existing %s email or issue its token', async role => {
    const f = await setup(); f.records.push({ email: 'user@example.com', role }); const r = await f.submit(await f.begin());
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('GOOGLE_EMAIL_CONFLICT'); expect(r.body).not.toHaveProperty('data'); expect(f.records).toHaveLength(1); expect(f.records[0]).not.toHaveProperty('googleSubject');
  });
  it.each(['user@gmail.com', 'user@company.example'])('links authoritative Google email %s without password and preserves account', async email => {
    const f=await setup();f.claims.email=email;if(email.endsWith('company.example'))f.claims.hd='company.example';
    const row={id:randomUUID(),email,name:'Original',role:'ADMIN',passwordHash:'unchanged',googleSubject:null,createdAt:new Date(),updatedAt:new Date()};f.records.push(row);
    const r=await f.submit(await f.begin());expect(r.status).toBe(200);expect(r.body.data.user).toMatchObject({id:row.id,name:'Original',role:'ADMIN'});expect(row.passwordHash).toBe('unchanged');expect(f.records).toHaveLength(1);
  });
  it.each([
    { hd: 'other.example', status: 409 }, { hd: 'company.example.evil', status: 409 }, { hd: '', status: 401 }, { hd: undefined, status: 409 },
  ])('refuses non-authoritative Workspace hd $hd', async ({ hd, status }) => {
    const f=await setup();f.claims.email='user@company.example';f.claims.hd=hd;f.records.push({id:randomUUID(),email:f.claims.email,passwordHash:'preserved',role:'USER',googleSubject:null});
    const r=await f.submit(await f.begin());expect(r.status).toBe(status);expect(f.records[0]).not.toHaveProperty('googleSubject', f.claims.sub);
  });
  it('links only with authenticated ownership, fresh password and verified Google evidence',async()=>{
    const f=await setup(),id=randomUUID(),password='existing-password-123';
    f.records.push({id,email:'user@example.com',name:'Original profile',role:'USER',passwordHash:await bcrypt.hash(password,4),createdAt:new Date(),updatedAt:new Date()});
    const link=async(pw:string,token?:string)=>{const a=await f.begin();const req=request(f.app).post('/api/auth/google/link').set('Origin',origin).set('Cookie',a.cookie);if(token)req.set('Authorization',`Bearer ${token}`);return req.send({...a.body,password:pw})};
    expect((await link(password)).status).toBe(401);
    const token=tokens.sign({userId:id,role:'USER'});
    expect((await link('wrong-password',token)).status).toBe(403);expect(f.records[0].googleSubject).toBeUndefined();
    const linked=await link(password,token);expect(linked.status).toBe(200);expect(linked.body.data.user.id).toBe(id);expect(linked.body.data.user.name).toBe('Original profile');expect(linked.body.data.user).not.toHaveProperty('passwordHash');
    expect((await f.submit(await f.begin())).body.data.user.id).toBe(id);expect(f.records).toHaveLength(1);
  });
  it('rejects linking a different verified email to the authenticated user',async()=>{
    const f=await setup(),id=randomUUID();f.records.push({id,email:'other@example.com',name:'Other',role:'USER',passwordHash:await bcrypt.hash('password-123',4),createdAt:new Date(),updatedAt:new Date()});
    const a=await f.begin(),r=await request(f.app).post('/api/auth/google/link').set('Origin',origin).set('Cookie',a.cookie).set('Authorization',`Bearer ${tokens.sign({userId:id,role:'USER'})}`).send({...a.body,password:'password-123'});
    expect(r.status).toBe(403);expect(f.records[0].googleSubject).toBeUndefined();
  });
  it('does not treat invalid Google linking evidence as an expired application session',async()=>{
    const f=await setup(),id=randomUUID();f.records.push({id,name:'Existing user',email:'person@example.com',role:'USER',passwordHash:await bcrypt.hash('password-123',4)});
    const a=await f.begin();f.reject();const r=await request(f.app).post('/api/auth/google/link').set('Origin',origin).set('Cookie',a.cookie).set('Authorization',`Bearer ${tokens.sign({userId:id,role:'USER'})}`).send({...a.body,password:'password-123'});
    expect(r.status).toBe(403);expect(r.body.error.code).toBe('GOOGLE_LINK_PROOF_REQUIRED');expect(f.records[0].googleSubject).toBeUndefined();
  });
  it('converges a subject uniqueness race to the database identity', async () => {
    const f = await setup(); const { AppError } = await import('../src/errors/app-error.js');
    f.store.createGoogle = async input => { const u = { ...input, id: randomUUID(), role: 'USER', passwordHash: null, createdAt: new Date(), updatedAt: new Date() }; f.records.push(u); throw new AppError(409, 'GOOGLE_IDENTITY_CONFLICT', 'Conflict'); };
    const r = await f.submit(await f.begin()); expect(r.status).toBe(200); expect(r.body.data.user.id).toBe(f.records[0].id);
  });
  it.each([undefined, 'null', 'https://evil.example', `${origin}/`, 'http://localhost:5174'])('rejects non-exact Origin %s before provider verification', async supplied => {
    const f = await setup(), a = await f.begin(); const req = request(f.app).post('/api/auth/google').set('Cookie', a.cookie); if (supplied) req.set('Origin', supplied);
    const r = await req.send(a.body); expect(r.status).toBe(403); expect(f.calls()).toBe(0);
  });
  it.each(['missing', 'tampered', 'duplicate', 'csrf', 'schema', 'content'])('rejects %s challenge submission before provider verification', async kind => {
    const f = await setup(), a = await f.begin(); let req = request(f.app).post('/api/auth/google').set('Origin', origin);
    if (kind !== 'missing') req = req.set('Cookie', kind === 'duplicate' ? `${a.cookie}; ${a.cookie}` : kind === 'tampered' ? `${a.cookie}bad` : a.cookie);
    const r = kind === 'content' ? await req.type('form').send(a.body) : await req.send(kind === 'csrf' ? { ...a.body, csrfToken: 'wrong' } : kind === 'schema' ? { ...a.body, role: 'ADMIN' } : a.body);
    expect(r.status).toBeGreaterThanOrEqual(400); expect(f.calls()).toBe(0); expect(f.records).toHaveLength(0);
  });
  it.each(['nonce', 'sub', 'aud', 'iss', 'exp', 'iat', 'email', 'email_verified'])('rejects invalid verified claim %s', async field => {
    const f = await setup(), a = await f.begin(); f.claims[field] = field === 'email_verified' ? false : field === 'sub' ? '' : field === 'exp' ? 1 : field === 'iat' ? Math.floor(Date.now() / 1000) + 900 : 'invalid';
    const r = await f.submit(a); expect(r.status).toBe(401); expect(f.records).toHaveLength(0);
  });
  it('does not disclose verifier rejection or database errors', async () => {
    const f = await setup(); f.reject(); const r = await f.submit(await f.begin()); expect(r.status).toBe(401); expect(r.text).not.toContain('private-credential');
    const db = await setup(); db.store.findBySubject = async () => { throw new Error('private-profile'); }; const failed = await db.submit(await db.begin()); expect(failed.status).toBe(500); expect(failed.text).not.toContain('private-profile');
  });
  it('uses HttpOnly SameSite cookies and Secure only in production', async () => {
    const local = await setup(), a = await local.begin(); expect(a.response.headers['set-cookie'][0]).toContain('HttpOnly'); expect(a.response.headers['set-cookie'][0]).toContain('SameSite=Lax'); expect(a.response.headers['set-cookie'][0]).not.toContain('Secure');
    const production = await setup(true, true); expect((await production.begin()).response.headers['set-cookie'][0]).toContain('Secure');
  });
  it('rejects an expired signed challenge before checking Google', async () => {
    const f = await setup(), a = await f.begin(); const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 301000);
    try { const r = await f.submit(a); expect(r.status).toBe(403); expect(f.calls()).toBe(0); } finally { clock.mockRestore(); }
  });
  it('does not accept an application JWT as a Google challenge cookie', async () => {
    const f = await setup(), a = await f.begin(); a.cookie = 'cinehook-google-challenge=' + tokens.sign({ userId: randomUUID(), role: 'USER' });
    const r = await f.submit(a); expect(r.status).toBe(403); expect(f.calls()).toBe(0);
  });
  it('does not link the winner of an email uniqueness race', async () => {
    const f = await setup(); const { AppError } = await import('../src/errors/app-error.js');
    f.store.createGoogle = async input => { f.records.push({ email: input.email, role: 'ADMIN' }); throw new AppError(409, 'GOOGLE_IDENTITY_CONFLICT', 'Conflict'); };
    const r = await f.submit(await f.begin()); expect(r.status).toBe(409); expect(r.body).not.toHaveProperty('data'); expect(f.records[0]).not.toHaveProperty('googleSubject');
  });
  it('converges when the same subject arrives between subject and email lookups', async () => {
    const f = await setup();
    f.store.findByEmail = async email => { const row = { email, googleSubject: f.claims.sub, id: randomUUID(), role: 'USER', name: 'Concurrent', createdAt: new Date(), updatedAt: new Date() }; f.records.push(row); return row; };
    const r = await f.submit(await f.begin()); expect(r.status).toBe(200); expect(r.body.data.user.id).toBe(f.records[0].id); expect(f.records).toHaveLength(1);
  });
  it('clears the challenge on a trusted-origin malformed JSON submission', async () => {
    const f = await setup(), a = await f.begin(); const r = await request(f.app).post('/api/auth/google').set('Origin', origin).set('Cookie', a.cookie).type('json').send('{broken');
    expect(r.status).toBe(400); expect(r.headers['set-cookie'][0]).toContain('Max-Age=0'); expect(f.calls()).toBe(0);
  });
});
