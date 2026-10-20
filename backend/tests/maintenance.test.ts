import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config/env.js';

function app(closed: boolean) {
  return createApp({ maintenanceMode: closed, frontendOrigin: 'https://cinehook.test',
    healthService: { readiness: async () => ({ status: 'ready' }) } as never,
    auth: { service: {} as never, tokens: { verify: () => { throw new Error('auth must not run'); } } as never },
    catalog: {} as never,
    payments: { payments: { handleWebhook: () => { throw new Error('webhook must not run'); } } } as never,
  });
}
describe('startup maintenance guard', () => {
  it('validates the startup switch and rejects ambiguous values', () => {
    const base = { DATABASE_URL: 'postgresql://user:pass@localhost/cinehook_dev', REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-only-configuration-secret-123456789', FRONTEND_ORIGIN: 'http://localhost:5173' };
    expect(parseConfig(base).maintenanceMode).toBe(false);
    expect(parseConfig({ ...base, MAINTENANCE_MODE: 'true' }).maintenanceMode).toBe(true);
    expect(() => parseConfig({ ...base, MAINTENANCE_MODE: 'yes' })).toThrow('MAINTENANCE_MODE');
  });
  it('blocks direct and Vercel-proxied requests regardless of old sessions or claimed bypass headers', async () => {
    const backend = app(true), proxy = express();
    proxy.use(async (req, res) => {
      const result = await request(backend).post(req.originalUrl).set(req.headers as Record<string, string>).send({});
      res.status(result.status).set('Retry-After', result.headers['retry-after']).send(result.body);
    });
    for (const target of [backend, proxy]) for (const path of ['/api/auth/login', '/api/auth/google', '/api/auth/ownership/request', '/api/bookings', '/api/bookings/id/cancel', '/api/payments/order', '/api/payments/verify']) {
      const response = await request(target).post(path).set('Authorization', 'Bearer old-session')
        .set('X-Forwarded-For', '127.0.0.1').set('X-Maintenance-Bypass', 'true').send({});
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('MAINTENANCE');
      expect(response.headers['retry-after']).toBe('60');
    }
  });
  it('defers webhook bytes without acknowledging or processing financial evidence', async () => {
    const response = await request(app(true)).post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json').set('x-razorpay-signature', 'not-a-signature').send('{malformed');
    expect(response.status).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('preserves health checks, blocks all other methods and restores normal routing on an open restart', async () => {
    for (const path of ['/api/health/live', '/api/health/ready']) expect((await request(app(true)).get(path)).status).toBe(200);
    expect((await request(app(true)).post('/api/health/live')).status).toBe(503);
    expect((await request(app(true)).get('/api/auth/google/config')).status).toBe(503);
    const opened = await request(app(false)).get('/api/auth/google/config');
    expect(opened.status).toBe(200);
    expect(opened.headers['x-cinehook-maintenance']).toBeUndefined();
  });
});
