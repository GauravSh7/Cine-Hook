import { expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';
import { HealthService } from '../src/modules/health/health.service.js';
import { testCatalog } from './helpers/catalog.js';

it('provides a safe recovery error when email delivery is not configured', async () => {
  const tokens = new TokenService({ secret: 'reset-test-secret-only-123456789012345', expiresInSeconds: 86400 });
  const service = new AuthService({ create: async () => { throw new Error('unused'); }, findByEmail: async () => null, findById: async () => null }, tokens);
  const app = createApp({ frontendOrigin: 'http://localhost:5173', auth: { service, tokens }, catalog: testCatalog().services,
    healthService: new HealthService({ checkDatabase: async () => {}, checkRedis: async () => {} }) });
  const response = await request(app).post('/api/auth/forgot-password').set('Origin', 'http://localhost:5173').send({ email: 'nobody@example.com' });
  expect(response.status).toBe(503);
  expect(response.body.error.code).toBe('PASSWORD_RESET_UNAVAILABLE');
  expect(JSON.stringify(response.body)).not.toMatch(/token|passwordHash|connectionString/);
});
