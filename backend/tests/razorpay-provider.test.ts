import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RazorpayProvider } from '../src/modules/payments/razorpay.provider.js';

const options = { keyId: 'rzp_test_fixture', keySecret: 'provider-test-only-api-secret', webhookSecret: 'provider-test-only-distinct-webhook-secret' };
const order = { id: 'order_test123', receipt: 'payment_test_receipt', amount: 25000, currency: 'INR', status: 'created' };
const payment = { id: 'pay_test123', order_id: order.id, amount: 25000, currency: 'INR', status: 'captured', captured: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const signed = (body: unknown, secret = options.webhookSecret) => {
  const raw = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return { raw, signature: createHmac('sha256', secret).update(raw).digest('hex') };
};
const capturedEvent = () => ({ event: 'payment.captured', payload: { payment: { entity: payment } } });
afterEach(() => vi.useRealTimers());
it('authenticates Checkout identifiers using the stored order and API secret', () => {
  const provider = new RazorpayProvider(options);
  const signature = createHmac('sha256', options.keySecret).update('order_test123|pay_test123').digest('hex');
  expect(provider.verifyCheckoutSignature('order_test123', 'pay_test123', signature)).toBe(true);
  expect(provider.verifyCheckoutSignature('order_other', 'pay_test123', signature)).toBe(false);
});
it.each(['', 'x', '0'.repeat(63), 'g'.repeat(64), '0'.repeat(65)])('rejects malformed Checkout signatures: %s', signature => {
  expect(new RazorpayProvider(options).verifyCheckoutSignature(order.id, payment.id, signature)).toBe(false);
});
it('does not accept the webhook secret as the Checkout secret', () => {
  const signature = createHmac('sha256', options.webhookSecret).update(`${order.id}|${payment.id}`).digest('hex');
  expect(new RazorpayProvider(options).verifyCheckoutSignature(order.id, payment.id, signature)).toBe(false);
});
it.each(['keyId', 'keySecret', 'webhookSecret'] as const)('fails closed if credentials are missing: %s', field => {
  expect(() => new RazorpayProvider({ ...options, [field]: '' })).toThrow(expect.objectContaining({ status: 503 }));
});

describe('authenticated webhook normalization', () => {
  it('validates exact raw bytes with the separate webhook secret and removes customer data', () => {
    const event = capturedEvent(); const { raw, signature } = signed(JSON.stringify(event, null, 2));
    const provider = new RazorpayProvider(options); const parsed = provider.parseWebhook(raw, signature);
    expect(parsed).toMatchObject({ eventType: 'payment.captured', payment: { id: payment.id, orderId: order.id, amountPaise: 25000, currency: 'INR', status: 'captured', captured: true } });
    expect(parsed.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => provider.parseWebhook(Buffer.from(JSON.stringify(event)), signature)).toThrow();
    const wrongSecret = signed(event, options.keySecret);
    expect(() => provider.parseWebhook(wrongSecret.raw, wrongSecret.signature)).toThrow();
    expect(parsed.payment).not.toHaveProperty('email'); expect(parsed).not.toHaveProperty('payload');
  });
  it('ignores unknown signed event entities and retains a digest for deduplication', () => {
    const { raw, signature } = signed({ event: 'customer.created', payload: { payment: { entity: { arbitrary: 'untrusted data' } } } });
    expect(new RazorpayProvider(options).parseWebhook(raw, signature)).toEqual({ eventType: 'customer.created', digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
  it('normalizes order.paid and requires consistent captured payment and order identities', () => {
    const event = { event: 'order.paid', payload: { payment: { entity: payment }, order: { entity: { ...order, status: 'paid' } } } };
    const good = signed(event); expect(new RazorpayProvider(options).parseWebhook(good.raw, good.signature).order).toMatchObject({ id: order.id, status: 'paid', amountPaise: 25000 });
    const bad = signed({ ...event, payload: { ...event.payload, order: { entity: { ...order, id: 'order_other', status: 'paid' } } } });
    expect(() => new RazorpayProvider(options).parseWebhook(bad.raw, bad.signature)).toThrow();
  });
  it('normalizes failed evidence without claiming capture', () => {
    const data = signed({ event: 'payment.failed', payload: { payment: { entity: { ...payment, status: 'failed', captured: false } } } });
    expect(new RazorpayProvider(options).parseWebhook(data.raw, data.signature).payment).toMatchObject({ status: 'failed', captured: false });
  });
  it.each([
    { ...payment, amount: 0 }, { ...payment, amount: 2.5 }, { ...payment, order_id: null },
    { ...payment, id: 'pay_test123/../orders' }, { ...payment, currency: 'inr' },
    { ...payment, captured: false }, { ...payment, status: 'authorized' },
  ])('rejects inconsistent or malformed signed capture entities: %j', entity => {
    const data = signed({ event: 'payment.captured', payload: { payment: { entity } } });
    expect(() => new RazorpayProvider(options).parseWebhook(data.raw, data.signature)).toThrow();
  });
  it('rejects invalid signatures before attempting JSON parsing', () => {
    expect(() => new RazorpayProvider(options).parseWebhook(Buffer.from('not JSON'), '0'.repeat(64))).toThrow(expect.objectContaining({ status: 400, code: 'INVALID_WEBHOOK_SIGNATURE' }));
    const data = signed('not JSON'); expect(() => new RazorpayProvider(options).parseWebhook(data.raw, data.signature)).toThrow(expect.objectContaining({ status: 400, code: 'INVALID_WEBHOOK_PAYLOAD' }));
  });
});

describe('bounded provider HTTP', () => {
  it('creates only a server-priced HTTPS order and authenticates the fixed provider origin', async () => {
    let called: { url: string; init?: RequestInit } | undefined;
    const provider = new RazorpayProvider(options, async (url, init) => { called = { url: String(url), init }; return json({ ...order, customer: { secret: 'drop' } }); });
    expect(await provider.createOrder({ receipt: order.receipt, amountPaise: 25000, currency: 'INR' })).toEqual({ id: order.id, receipt: order.receipt, amountPaise: 25000, currency: 'INR', status: 'created' });
    expect(called!.url).toBe('https://api.razorpay.com/v1/orders');
    expect(called!.init!.method).toBe('POST'); expect(called!.init!.redirect).toBe('error');
    expect(JSON.parse(called!.init!.body as string)).toEqual({ receipt: order.receipt, amount: 25000, currency: 'INR', partial_payment: false });
    expect(new Headers(called!.init!.headers).get('authorization')).toBe(`Basic ${Buffer.from(`${options.keyId}:${options.keySecret}`).toString('base64')}`);
    expect(called!.init!.signal).toBeInstanceOf(AbortSignal);
  });
  it('fetches normalized authorized payments without mistaking them for captured money', async () => {
    const provider = new RazorpayProvider(options, async () => json({ ...payment, status: 'authorized', captured: false, email: 'private@example.com' }));
    expect(await provider.fetchPayment(payment.id)).toEqual({ id: payment.id, orderId: order.id, amountPaise: 25000, currency: 'INR', status: 'authorized', captured: false });
  });
  it('recovers a duplicate receipt via one lookup without issuing another POST', async () => {
    const methods: string[] = [];
    const provider = new RazorpayProvider(options, async (_url, init) => { methods.push(init!.method!); return methods.length === 1
      ? json({ error: { code: 'BAD_REQUEST_ERROR', description: 'Duplicate request. This request has already been processed.' } }, 400)
      : json({ items: [{ ...order, receipt: 'unrelated' }, order] }); });
    expect((await provider.createOrder({ receipt: order.receipt, amountPaise: 25000, currency: 'INR' })).id).toBe(order.id);
    expect(methods).toEqual(['POST', 'GET']);
  });
  it('rejects duplicate receipt recovery with a different amount instead of trusting a reused provider order', async () => {
    let calls = 0;
    const provider = new RazorpayProvider(options, async () => ++calls === 1
      ? json({ error: { code: 'BAD_REQUEST_ERROR', description: 'Duplicate request. This request has already been processed.' } }, 400)
      : json({ items: [{ ...order, amount: 1 }] }));
    await expect(provider.createOrder({ receipt: order.receipt, amountPaise: 25000, currency: 'INR' })).rejects.toMatchObject({ status: 502 });
    expect(calls).toBe(2);
  });
  it('finds only the exact receipt, rejects ambiguous matches and returns null for absence', async () => {
    expect(await new RazorpayProvider(options, async () => json({ items: [{ ...order, receipt: 'unrelated' }] })).findOrder(order.receipt)).toBeNull();
    await expect(new RazorpayProvider(options, async () => json({ items: [order, { ...order, id: 'order_second' }] })).findOrder(order.receipt)).rejects.toMatchObject({ status: 502 });
  });
  it.each([{ ...order, amount: 1 }, { ...order, receipt: 'foreign' }, { ...order, currency: 'USD' }])('rejects a mismatched created order: %j', response => {
    return expect(new RazorpayProvider(options, async () => json(response)).createOrder({ receipt: order.receipt, amountPaise: 25000, currency: 'INR' })).rejects.toMatchObject({ status: 502 });
  });
  it('rejects fetch responses for another requested payment or order', async () => {
    await expect(new RazorpayProvider(options, async () => json({ ...payment, id: 'pay_foreign' })).fetchPayment(payment.id)).rejects.toMatchObject({ status: 502 });
    await expect(new RazorpayProvider(options, async () => json({ ...order, id: 'order_foreign' })).fetchOrder(order.id)).rejects.toMatchObject({ status: 502 });
  });
  it.each([{}, { ...payment, amount: '25000' }, { ...payment, captured: 'true' }, { ...payment, status: 'captured', captured: false }])('rejects malformed API payment responses: %j', response => {
    return expect(new RazorpayProvider(options, async () => json(response)).fetchPayment(payment.id)).rejects.toMatchObject({ status: 502 });
  });
  it('does not disclose credentials or raw external errors', async () => {
    const provider = new RazorpayProvider(options, async () => { throw new Error(`network failed: ${options.keySecret}`); });
    try { await provider.fetchOrder(order.id); throw new Error('Expected failure'); }
    catch (error) { expect(error).toMatchObject({ status: 503 }); expect(String(error)).not.toContain(options.keySecret); }
  });
  it('bounds stalled headers and never repeats an ambiguously completed order POST', async () => {
    vi.useFakeTimers(); let calls = 0, signal: AbortSignal | null | undefined;
    const provider = new RazorpayProvider(options, async (_url, init) => { calls++; signal = init!.signal; return new Promise(() => {}); });
    const result = expect(provider.createOrder({ receipt: order.receipt, amountPaise: 25000, currency: 'INR' })).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(2000); await result; expect(signal!.aborted).toBe(true); expect(calls).toBe(1);
  });
  it('bounds a stalled response body under the same deadline', async () => {
    vi.useFakeTimers();
    const provider = new RazorpayProvider(options, async () => new Response(new ReadableStream({ start() {} })));
    const result = expect(provider.fetchOrder(order.id)).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(2000); await result;
  });
  it('rejects oversized bodies even without a Content-Length header', async () => {
    const provider = new RazorpayProvider(options, async () => json({ ...order, notes: 'x'.repeat(262145) }));
    await expect(provider.fetchOrder(order.id)).rejects.toMatchObject({ status: 502 });
  });
  it('rejects oversized declared bodies and does not follow a redirect response', async () => {
    await expect(new RazorpayProvider(options, async () => new Response(JSON.stringify(order), { headers: { 'content-length': '262145' } })).fetchOrder(order.id)).rejects.toMatchObject({ status: 502 });
    await expect(new RazorpayProvider(options, async () => new Response(null, { status: 302, headers: { location: 'https://attacker.invalid' } })).fetchOrder(order.id)).rejects.toMatchObject({ status: 502 });
  });
  it('rejects unsafe request identifiers without contacting another URL', async () => {
    const provider = new RazorpayProvider(options, async () => { throw new Error('Must not contact provider'); });
    await expect(provider.fetchPayment('https://attacker.invalid')).rejects.toMatchObject({ status: 400 });
    await expect(provider.fetchOrder('order_test/../../payments')).rejects.toMatchObject({ status: 400 });
  });
});
