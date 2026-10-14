import { describe, expect, it } from 'vitest';
import { PaymentService } from '../src/modules/payments/payment.service.js';
import type { PaymentStore } from '../src/modules/payments/payment.types.js';
import type { FinancialBookings } from '../src/modules/booking/booking-gateway.js';
import type { PaymentProvider } from '../src/modules/payments/payment-provider.js';
import { catalogueStageStatus, catalogueTargetFingerprint } from '../src/lib/catalogue-stage.js';
import { resolveStagingTarget, verifyStagingBackend } from '../scripts/staging-target.js';
import { parseConfig } from '../src/config/env.js';

describe('staging publication safety', () => {
  it('blocks new orders before touching bookings, payments or external providers', async () => {
    const unreachable = new Proxy({}, { get: () => { throw new Error('Staging order attempted a persistence/provider action'); } });
    const service = new PaymentService(unreachable as PaymentStore, unreachable as FinancialBookings, unreachable as PaymentProvider, undefined, false);
    await expect(service.order('owner', 'booking')).rejects.toMatchObject({ code: 'PAYMENTS_UNAVAILABLE', status: 503 });
  });
  it('fingerprints direct and pooled connections identically without using the password', () => {
    const direct = 'postgresql://catalogue:placeholder@ep-test.region.aws.neon.tech/neondb?sslmode=verify-full';
    const pooled = 'postgresql://catalogue:different@ep-test-pooler.region.aws.neon.tech/neondb?sslmode=require';
    expect(catalogueTargetFingerprint(direct)).toBe(catalogueTargetFingerprint(pooled));
    expect(catalogueStageStatus(direct, false)).toEqual({ mode: 'standard', newPaymentsAllowed: true, targetFingerprint: null });
    expect(JSON.stringify(catalogueStageStatus(direct, true))).not.toMatch(/placeholder|postgresql|neon\.tech/);
  });
  it('requires the deployed staging guard and matching database target before import', async () => {
    const target = resolveStagingTarget({ STAGING_IMPORT_ENV: 'staging', STAGING_DATABASE_URL: 'postgresql://catalogue:placeholder@ep-test.region.aws.neon.tech/neondb?sslmode=verify-full',
      STAGING_EXPECTED_HOST: 'ep-test.region.aws.neon.tech', STAGING_EXPECTED_DATABASE: 'neondb', STAGING_EXPECTED_ROLE: 'catalogue', STAGING_BACKEND_ORIGIN: 'https://cinehook.onrender.com' });
    const fetcher = (data: unknown) => (async () => Response.json({ success: true, data })) as typeof fetch;
    await expect(verifyStagingBackend(target, fetcher(catalogueStageStatus(target.url, true)))).resolves.toBeUndefined();
    for (const overrides of [{ mode: 'standard' }, { newPaymentsAllowed: true }, { targetFingerprint: 'wrong' }]) {
      await expect(verifyStagingBackend(target, fetcher({ ...catalogueStageStatus(target.url, true), ...overrides }))).rejects.toThrow();
    }
  });
  it('staging mode is explicit and off by default', () => {
    const env = { DATABASE_URL: 'postgresql://example:placeholder@localhost/cinehook', REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'only-a-test-fixture-with-more-than-32-characters', FRONTEND_ORIGIN: 'http://localhost:5173' };
    expect(parseConfig(env).stagingCatalogueMode).toBe(false);
    expect(parseConfig({ ...env, STAGING_CATALOGUE_MODE: 'true' }).stagingCatalogueMode).toBe(true);
  });
});
