import { describe, expect, it } from 'vitest';
import { RazorpayProvider } from '../src/modules/payments/razorpay.provider.js';

import * as fixture from './ui-browser-server.mjs';
const credentials = { keyId: 'rzp_test_ui', keySecret: 'ui-only-transport-secret', webhookSecret: 'ui-only-webhook-secret-123456789012345' };

describe('isolated browser fixture safety', () => {
  it('requires exact native fixture role and ports before persistence', () => {
    for (const db of ['postgresql://other@127.0.0.1:55438/ui_test', 'postgresql://cinehook_verify@127.0.0.1:5432/ui_test']) {
      expect(() => fixture.validateFixtureTargets(db, 'redis://127.0.0.1:55439/15')).toThrow();
    }
    expect(() => fixture.validateFixtureTargets('postgresql://cinehook_verify@127.0.0.1:55438/ui_test', 'redis://127.0.0.1:6379/15')).toThrow();
  });
  it('rejects absent/cross origin and extra payment flags for controlled helpers', () => {
    const body = { orderId: 'order_local123' };
    expect(() => fixture.validateControlledOrderRequest(undefined, body)).toThrow();
    expect(() => fixture.validateControlledOrderRequest('https://evil.invalid', body)).toThrow();
    expect(() => fixture.validateControlledOrderRequest('http://127.0.0.1:55440', { ...body, paid: true })).toThrow();
    expect(() => fixture.validateControlledOrderRequest('http://127.0.0.1:55440', { orderId: 'unknown' })).toThrow();
    expect(fixture.validateControlledOrderRequest('http://127.0.0.1:55440', body)).toBe('order_local123');
  });
  it.each([
    ['postgresql://localhost/cinehook', 'redis://localhost/15'],
    ['postgresql://remote.invalid/cinehook_ui_test', 'redis://localhost/15'],
    ['postgresql://localhost/cinehook_ui_test', 'redis://remote.invalid/15'],
    ['postgresql://localhost/cinehook_ui_test', 'redis://localhost/0'],
    ['https://localhost/cinehook_ui_test', 'redis://localhost/15'],
    [undefined, 'redis://localhost/15'],
  ])('refuses unsafe persistence targets before opening connections', (db, redis) => {
    expect(() => fixture.validateFixtureTargets(db, redis)).toThrow();
  });
  it('accepts explicit loopback test DB and Redis15 without emitting credentials', () => {
    expect(fixture.validateFixtureTargets('postgresql://cinehook_verify@127.0.0.1:55438/cinehook_ui_test', 'redis://127.0.0.1:55439/15'))
      .toEqual({ databaseUrl: 'postgresql://cinehook_verify@127.0.0.1:55438/cinehook_ui_test', redisUrl: 'redis://127.0.0.1:55439/15' });
  });
});

describe('controlled provider transport with actual Razorpay adapter', () => {
  it('signs raw captured webhook bytes and replays the same event without inventing a second capture', async () => {
    const local = fixture.createControlledProviderTransport(credentials);
    const provider = new RazorpayProvider(credentials, local.transport);
    const order = await provider.createOrder({ receipt: 'closed-browser', amountPaise: 45000, currency: 'INR' });
    const event = local.capturedWebhook(order.id);
    expect(provider.parseWebhook(event.raw, event.signature)).toMatchObject({ eventType: 'payment.captured', payment: { orderId: order.id, amountPaise: 45000, captured: true } });
    const replay = local.capturedWebhook(order.id);
    expect(replay.eventId).toBe(event.eventId); expect(replay.raw.equals(event.raw)).toBe(true);
    expect(() => provider.parseWebhook(Buffer.from('{}'), event.signature)).toThrow();
  });
  it('refuses provider HTTP inside active database transactions', async () => {
    const local = fixture.createControlledProviderTransport(credentials, Date.now, () => true);
    const provider = new RazorpayProvider(credentials, local.transport);
    await expect(provider.createOrder({ receipt: 'transaction-rejected', amountPaise: 30000, currency: 'INR' })).rejects.toThrow();
  });
  it('records a failed provider attempt with no capture and cannot downgrade a captured payment', async () => {
    const local = fixture.createControlledProviderTransport(credentials);
    const provider = new RazorpayProvider(credentials, local.transport);
    const order = await provider.createOrder({ receipt: 'failed-ui-order', amountPaise: 30000, currency: 'INR' });
    const failed = local.fail(order.id);
    expect(await provider.fetchPayment(failed.id)).toMatchObject({ orderId: order.id, status: 'failed', captured: false, amountPaise: 30000 });
    const capturedOrder = await provider.createOrder({ receipt: 'captured-ui-order', amountPaise: 30000, currency: 'INR' });
    const captured = local.capture(capturedOrder.id);
    expect(() => local.fail(capturedOrder.id)).toThrow();
    expect(await provider.fetchPayment(captured.razorpay_payment_id)).toMatchObject({ status: 'captured', captured: true });
  });
  it('derives captures from reserved provider orders and signs real adapter verification', async () => {
    const local = fixture.createControlledProviderTransport(credentials);
    const provider = new RazorpayProvider(credentials, local.transport);
    const order = await provider.createOrder({ receipt: 'ui-browser-receipt', amountPaise: 45000, currency: 'INR' });
    const capture = local.capture(order.id);
    expect(provider.verifyCheckoutSignature(capture.razorpay_order_id, capture.razorpay_payment_id, capture.razorpay_signature)).toBe(true);
    expect(await provider.fetchPayment(capture.razorpay_payment_id)).toMatchObject({ orderId: order.id, amountPaise: 45000,
      currency: 'INR', status: 'captured', captured: true });
    expect(local.capture(order.id)).toEqual(capture);
    expect(() => local.capture('order_unknown')).toThrow();
  });
  it('uses stable refund idempotency and advances only provider evidence after its delay', async () => {
    let now = 1000;
    const local = fixture.createControlledProviderTransport(credentials, () => now);
    const provider = new RazorpayProvider(credentials, local.transport);
    const order = await provider.createOrder({ receipt: 'refund-order', amountPaise: 30000, currency: 'INR' });
    const capture = local.capture(order.id);
    const input = { paymentId: capture.razorpay_payment_id, amountPaise: 30000, currency: 'INR', receipt: 'refund-receipt',
      idempotencyKey: '55440000-0000-4000-8000-000000000099' };
    const refund = await provider.createRefund(input);
    expect(refund.status).toBe('pending');
    expect((await provider.createRefund(input)).id).toBe(refund.id);
    now = 2999; expect((await provider.fetchRefund(refund.id)).status).toBe('pending');
    now = 3000; expect((await provider.fetchRefund(refund.id)).status).toBe('processed');
  });
});
