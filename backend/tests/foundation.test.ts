import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config/env.js';
import { HealthService } from '../src/modules/health/health.service.js';
import { requestId } from '../src/middleware/request-id.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { testCatalog } from './helpers/catalog.js';

const tokens = new TokenService({ secret: 'test-only-signing-secret-1234567890123456789', expiresInSeconds: 3600 });

const env = {
  DATABASE_URL: 'postgresql://example:example@localhost:5432/cinehook',
  REDIS_URL: 'redis://localhost:6379',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  JWT_SECRET: 'test-only-signing-secret-1234567890123456789',
};
const app = (db = true, redis = true) => createApp({
  frontendOrigin: env.FRONTEND_ORIGIN,
  catalog: testCatalog().services,
  auth: { tokens, service: new AuthService({
    create: async () => { throw new Error('Database unavailable in health-only test'); },
    findByEmail: async () => null,
    findById: async () => null,
  }, tokens) },
  healthService: new HealthService({
    checkDatabase: async () => { if (!db) throw new Error('private database password'); },
    checkRedis: async () => { if (!redis) throw new Error('private redis password'); },
  }),
});

describe('configuration', () => {
  it('rejects missing connection URLs', () => expect(() => parseConfig({})).toThrow());
  it('rejects invalid ports and URL protocols', () => {
    for (const overrides of [{ PORT: '0' }, { PORT: '65536' }, { PORT: 'abc' },
      { DATABASE_URL: 'https://example.com' }, { REDIS_URL: 'https://example.com' },
      { FRONTEND_ORIGIN: 'http://localhost:5173/path' }]) {
      expect(() => parseConfig({ ...env, ...overrides })).toThrow();
    }
  });
  it('accepts explicit valid configuration and provides the default port', () => {
    expect(parseConfig(env).port).toBe(4000);
    expect(parseConfig({ ...env, PORT: '4500' }).port).toBe(4500);
  });
});

describe('HTTP foundation', () => {
  it('is live even when both dependencies are unavailable', async () => {
    const response = await request(app(false, false)).get('/api/health/live');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('alive');
    expect(response.headers['x-request-id']).toBeTruthy();
  });
  it('is ready only when both dependencies are healthy', async () => {
    const response = await request(app()).get('/api/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ status: 'ready', database: 'up', redis: 'up' });
  });
  it.each([[false, true, 'down', 'up'], [true, false, 'up', 'down'], [false, false, 'down', 'down']])(
    'reports unavailable dependencies without leaking their errors', async (db, redis, databaseStatus, redisStatus) => {
      const response = await request(app(db as boolean, redis as boolean)).get('/api/health/ready');
      expect(response.status).toBe(503);
      expect(response.body.data).toEqual({ status: 'unavailable', database: databaseStatus, redis: redisStatus });
      expect(response.text).not.toContain('password');
    },
  );
  it('returns a JSON 404 for unknown routes', async () => {
    const response = await request(app()).get('/api/missing');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });
  it('returns a safe 400 for malformed JSON', async () => {
    const response = await request(app()).post('/api/missing').set('Content-Type', 'application/json').send('{');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
    expect(response.body.error.stack).toBeUndefined();
  });
  it('restricts CORS to the configured frontend origin', async () => {
    const allowed = await request(app()).get('/api/health/live').set('Origin', env.FRONTEND_ORIGIN);
    const other = await request(app()).get('/api/health/live').set('Origin', 'https://other.example');
    expect(allowed.headers['access-control-allow-origin']).toBe(env.FRONTEND_ORIGIN);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('rejects oversized JSON before reaching routes', async () => {
    const response = await request(app()).post('/api/missing').send({ payload: 'x'.repeat(110000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
  it('does not expose unexpected exception details to clients or logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const failingApp = express();
      failingApp.use(requestId);
      failingApp.get('/failure', () => { throw new Error('secret credential'); });
      failingApp.use(errorHandler);
      const response = await request(failingApp).get('/failure');
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(response.text).not.toContain('secret credential');
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret credential');
    } finally { log.mockRestore(); }
  });
  it('bounds readiness when a dependency never responds', async () => {
    vi.useFakeTimers();
    try {
      const service = new HealthService({
        checkDatabase: () => new Promise<void>(() => {}),
        checkRedis: async () => {},
      });
      const result = service.readiness();
      await vi.advanceTimersByTimeAsync(15000);
      expect(await result).toEqual({ status: 'unavailable', database: 'down', redis: 'up' });
    } finally { vi.useRealTimers(); }
  });
});
