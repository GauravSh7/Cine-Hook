import { expect, it } from 'vitest';
import { parseConfig } from '../src/config/env.js';

const base = { DATABASE_URL: 'postgresql://example:example@localhost:5432/cinehook',
  REDIS_URL: 'redis://localhost:6379', FRONTEND_ORIGIN: 'http://localhost:5173' };
it('requires an explicitly configured strong JWT key', () => {
  expect(() => parseConfig(base)).toThrow(/JWT_SECRET/);
  expect(() => parseConfig({ ...base, JWT_SECRET: 'weak' })).toThrow(/JWT_SECRET/);
});
it('rejects invalid token lifetime without exposing configuration values', () => {
  const valid = { ...base, JWT_SECRET: 'test-only-signing-secret-1234567890123456789' };
  for (const value of ['0', '-1', 'abc', '86401']) {
    expect(() => parseConfig({ ...valid, JWT_EXPIRES_IN_SECONDS: value })).toThrow(/JWT_EXPIRES_IN_SECONDS/);
  }
  expect(parseConfig(valid).jwtExpiresInSeconds).toBe(86400);
});
