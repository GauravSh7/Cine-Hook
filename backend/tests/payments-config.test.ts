import { expect, it } from 'vitest';
import { parseConfig } from '../src/config/env.js';

const base = { DATABASE_URL: 'postgresql://test:test@localhost:5432/cinehook_test', REDIS_URL: 'redis://localhost:6379/15',
  FRONTEND_ORIGIN: 'http://localhost:5173', JWT_SECRET: 'test-only-jwt-key-123456789012345678901' };
const keys = { RAZORPAY_KEY_ID: 'rzp_test_fixture', RAZORPAY_KEY_SECRET: 'test-only-api-key-12345678901234567890',
  RAZORPAY_WEBHOOK_SECRET: 'test-only-webhook-key-12345678901234567890' };
it('requires explicit opt-in and local cinehook_dev for simulated Razorpay TEST checkout',()=>{
  const allowed={...base,...keys,DATABASE_URL:'postgresql://test:test@127.0.0.1:5432/cinehook_dev',DEV_RAZORPAY_TEST_CHECKOUT:'true'};
  expect(parseConfig(allowed).devRazorpayTestCheckout).toBe(true);
  expect(parseConfig({...allowed,DEV_RAZORPAY_TEST_CHECKOUT:'false'}).devRazorpayTestCheckout).toBe(false);
  for(const override of [{NODE_ENV:'production'},{RAZORPAY_KEY_ID:'rzp_live_fixture'},{DATABASE_URL:base.DATABASE_URL},{DATABASE_URL:'postgresql://test:test@remote.example:5432/cinehook_dev'},{RAZORPAY_WEBHOOK_SECRET:''}]){
    expect(()=>parseConfig({...allowed,...override})).toThrow(/Invalid configuration/);
  }
});

it('provides provider configuration only when all three credentials are present', () => {
  expect(parseConfig({ ...base, ...keys }).razorpay).toEqual({ keyId: keys.RAZORPAY_KEY_ID,
    keySecret: keys.RAZORPAY_KEY_SECRET, webhookSecret: keys.RAZORPAY_WEBHOOK_SECRET });
});
it('keeps non-payment development usable with absent or blank provider keys', () => {
  expect(parseConfig(base).razorpay).toBeUndefined();
  expect(parseConfig({ ...base, RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAY_WEBHOOK_SECRET: '' }).razorpay).toBeUndefined();
});
it('accepts provider-issued API secrets without imposing our own webhook-secret length', () => {
  const providerSecret = 'test-provider-key-24char';
  expect(parseConfig({ ...base, ...keys, RAZORPAY_KEY_SECRET: providerSecret }).razorpay?.keySecret).toBe(providerSecret);
});
it('rejects partial or weak configuration without echoing any secret values', () => {
  for (const overrides of [{ RAZORPAY_KEY_ID: keys.RAZORPAY_KEY_ID }, { ...keys, RAZORPAY_WEBHOOK_SECRET: 'private-value' }]) {
    expect(() => parseConfig({ ...base, ...overrides })).toThrow(/Invalid configuration/);
    try { parseConfig({ ...base, ...overrides }); } catch (error) { expect(String(error)).not.toContain('private-value'); }
  }
});
it('rejects oversized provider credentials without echoing their values', () => {
  expect(() => parseConfig({ ...base, ...keys, RAZORPAY_KEY_SECRET: 'x'.repeat(513) })).toThrow(/Invalid configuration/);
});
