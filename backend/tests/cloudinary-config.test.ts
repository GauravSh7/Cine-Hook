import { expect, it } from 'vitest';
import { parseConfig } from '../src/config/env.js';
const base = { DATABASE_URL: 'postgresql://test:test@localhost:1/test', REDIS_URL: 'redis://localhost:1',
  JWT_SECRET: 'test-only-jwt-secret-1234567890123456789', FRONTEND_ORIGIN: 'http://localhost:5173' };
it('allows no Cloudinary configuration without affecting other modules', () => { expect(parseConfig(base).cloudinary).toBeUndefined(); });
it('returns complete optional Cloudinary configuration', () => {
  expect(parseConfig({ ...base, CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'key', CLOUDINARY_API_SECRET: 'provider-secret' }).cloudinary)
    .toEqual({ cloudName: 'demo', apiKey: 'key', apiSecret: 'provider-secret' });
});
it.each([{ CLOUDINARY_API_SECRET: 'private-value' }, { CLOUDINARY_CLOUD_NAME: '../escape', CLOUDINARY_API_KEY: 'key', CLOUDINARY_API_SECRET: 'private-value' }])('fails partial or invalid provider config without leaking credentials', addition => {
  expect(() => parseConfig({ ...base, ...addition })).toThrow(/CLOUDINARY/);
  try { parseConfig({ ...base, ...addition }); } catch (error) { expect(String(error)).not.toContain('private-value'); }
});
