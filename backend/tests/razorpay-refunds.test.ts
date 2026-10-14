import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RazorpayProvider } from '../src/modules/payments/razorpay.provider.js';

const options = { keyId: 'rzp_test_refund_fixture', keySecret: 'refund-test-only-api-secret', webhookSecret: 'refund-test-only-webhook-secret' };
const attemptId = '550e8400-e29b-41d4-a716-446655440000';
const input = { paymentId: 'pay_refund123', amountPaise: 25000, currency: 'INR', receipt: attemptId, idempotencyKey: attemptId };
const refund = { id: 'rfnd_test123', entity: 'refund', payment_id: 'pay_refund123', amount: 25000,
  currency: 'INR', receipt: attemptId, status: 'pending', notes: {}, acquirer_data: { arn: null }, created_at: 1791370000, batch_id: null, speed_requested: 'normal', speed_processed: 'normal' };
const normalized = { id: 'rfnd_test123', paymentId: 'pay_refund123', amountPaise: 25000, currency: 'INR', receipt: attemptId, status: 'pending' };
const payment = { id: 'pay_refund123', order_id: 'order_test123', amount: 25000, currency: 'INR', status: 'captured', captured: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const signed = (event: string, entity: unknown, relatedPayment?: unknown) => {
  const raw = Buffer.from(JSON.stringify({ event, payload: { refund: { entity }, ...(relatedPayment ? { payment: { entity: relatedPayment } } : {}) } }, null, 2));
  return { raw, signature: createHmac('sha256', options.webhookSecret).update(raw).digest('hex') };
};
afterEach(() => vi.useRealTimers());

describe('Razorpay normal refund HTTP boundary', () => {
  it('sends the explicit trusted amount and persisted UUID on authenticated fixed-origin HTTPS', async () => {
    let sent: { url: string; init?: RequestInit } | undefined;
    const provider = new RazorpayProvider(options, async (url, init) => { sent = { url: String(url), init }; return json({ ...refund, error_description: 'private details' }); });
    expect(await provider.createRefund(input)).toEqual(normalized);
    expect(sent!.url).toBe('https://api.razorpay.com/v1/payments/pay_refund123/refund');
    expect(sent!.init!.method).toBe('POST'); expect(sent!.init!.redirect).toBe('error');
    expect(JSON.parse(sent!.init!.body as string)).toEqual({ amount: 25000, speed: 'normal', receipt: attemptId });
    expect(new Headers(sent!.init!.headers).get('X-Refund-Idempotency')).toBe(attemptId);
    expect(new Headers(sent!.init!.headers).get('authorization')).toBe(`Basic ${Buffer.from(`${options.keyId}:${options.keySecret}`).toString('base64')}`);
    expect(sent!.init!.signal).toBeInstanceOf(AbortSignal);
  });
  it('reuses identical body and key after an unknown response without an automatic extra request', async () => {
    const sent: { body: unknown; key: string | null }[] = [];
    const provider = new RazorpayProvider(options, async (_url, init) => {
      sent.push({ body: init!.body, key: new Headers(init!.headers).get('X-Refund-Idempotency') });
      if (sent.length === 1) throw new Error('network response lost');
      return json(refund);
    });
    await expect(provider.createRefund(input)).rejects.toMatchObject({ status: 503, code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
    expect(sent).toHaveLength(1);
    expect(await provider.createRefund(input)).toEqual(normalized);
    expect(sent).toEqual([
      { body: `{"amount":25000,"speed":"normal","receipt":"${attemptId}"}`, key: attemptId },
      { body: `{"amount":25000,"speed":"normal","receipt":"${attemptId}"}`, key: attemptId },
    ]);
  });
  it('keeps response binding tied to the trusted request snapshot while the input object changes', async () => {
    const mutable = { ...input };
    const provider = new RazorpayProvider(options, async () => {
      mutable.amountPaise = 1; mutable.currency = 'USD'; mutable.paymentId = 'pay_other'; mutable.receipt = 'other';
      return json({ ...refund, amount: 1, currency: 'USD', payment_id: 'pay_other', receipt: 'other' });
    });
    await expect(provider.createRefund(mutable)).rejects.toMatchObject({ status: 502, code: 'PAYMENT_PROVIDER_RESPONSE_INVALID' });
  });
  it.each([
    { paymentId: 'pay_refund123/../orders' }, { paymentId: '' }, { amountPaise: 0 }, { amountPaise: -1 },
    { amountPaise: 1.5 }, { amountPaise: Number.MAX_SAFE_INTEGER + 1 }, { currency: 'inr' },
    { receipt: '' }, { receipt: 'x'.repeat(41) }, { receipt: 'unsafe\nheader' },
    { idempotencyKey: '' }, { idempotencyKey: 'not-a-uuid' }, { idempotencyKey: `${attemptId}\r\nx: injected` },
  ])('rejects unsafe refund input before transport: %j', async change => {
    let requests = 0;
    const provider = new RazorpayProvider(options, async () => { requests++; return json(refund); });
    await expect(provider.createRefund({ ...input, ...change })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(requests).toBe(0);
  });
  it.each([
    { id: 'rfnd_bad/../payments' }, { entity: 'payment' }, { payment_id: 'pay_other' }, { amount: 1 },
    { amount: 0 }, { amount: 1.5 }, { amount: Number.MAX_SAFE_INTEGER + 1 }, { currency: 'USD' },
    { receipt: null }, { receipt: 'other' }, { status: 'created' }, { payment_id: null },
  ])('rejects malformed or unbound creation evidence: %j', async change => {
    const provider = new RazorpayProvider(options, async () => json({ ...refund, ...change }));
    await expect(provider.createRefund(input)).rejects.toMatchObject({ status: 502, code: 'PAYMENT_PROVIDER_RESPONSE_INVALID' });
  });
  it.each([400, 401, 409, 429, 500])('keeps HTTP %s safe and never retries without a caller decision', async status => {
    let requests = 0;
    const provider = new RazorpayProvider(options, async () => { requests++; return json({ error: { description: `${options.keySecret}: private provider account` } }, status); });
    const error = await provider.createRefund(input).catch(value => value);
    expect(error).toMatchObject({ status: 502, code: 'PAYMENT_PROVIDER_RESPONSE_INVALID' });
    expect(String(error)).not.toContain(options.keySecret); expect(String(error)).not.toContain('private provider account');
    expect(requests).toBe(1);
  });
  it('times out stalled refund transport and aborts the request without retry', async () => {
    vi.useFakeTimers(); let requests = 0; let signal: AbortSignal | undefined;
    const provider = new RazorpayProvider(options, async (_url, init) => { requests++; signal = init!.signal as AbortSignal; return new Promise<Response>(() => {}); });
    const pending = expect(provider.createRefund(input)).rejects.toMatchObject({ status: 503, code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(2001); await pending;
    expect(requests).toBe(1); expect(signal!.aborted).toBe(true);
  });
  it('rejects oversized response bodies using the existing bounded reader', async () => {
    const provider = new RazorpayProvider(options, async () => json({ ...refund, notes: { oversized: 'x'.repeat(262144) } }));
    await expect(provider.createRefund(input)).rejects.toMatchObject({ status: 502 });
  });
  it.each(['pending', 'processed', 'failed'])('fetches one refund identity with normalized %s status and nullable receipt', async status => {
    let url: string | undefined;
    const provider = new RazorpayProvider(options, async value => { url = String(value); return json({ ...refund, status, receipt: null, error_description: 'private' }); });
    expect(await provider.fetchRefund('rfnd_test123')).toEqual({ ...normalized, status, receipt: null });
    expect(url).toBe('https://api.razorpay.com/v1/refunds/rfnd_test123');
  });
  it('rejects a different fetched refund identity', async () => {
    const provider = new RazorpayProvider(options, async () => json({ ...refund, id: 'rfnd_other' }));
    await expect(provider.fetchRefund('rfnd_test123')).rejects.toMatchObject({ status: 502 });
  });
  it('rejects an unsafe fetch ID before transport', async () => {
    let requests = 0;
    const provider = new RazorpayProvider(options, async () => { requests++; return json(refund); });
    await expect(provider.fetchRefund('rfnd_test123?pay=other')).rejects.toMatchObject({ status: 400 });
    expect(requests).toBe(0);
  });
});

describe('authenticated refund webhooks', () => {
  it.each([
    ['refund.created', 'pending'], ['refund.created', 'processed'], ['refund.processed', 'processed'], ['refund.failed', 'failed'],
  ])('normalizes %s with %s evidence after authenticating exact raw bytes', (event, status) => {
    const data = signed(event, { ...refund, status, notes: { email: 'private@example.com' } }, payment);
    const provider = new RazorpayProvider(options);
    expect(provider.parseWebhook(data.raw, data.signature)).toEqual({ eventType: event, refund: { ...normalized, status }, payment: {
      id: 'pay_refund123', orderId: 'order_test123', amountPaise: 25000, currency: 'INR', status: 'captured', captured: true,
    }, digest: createHash('sha256').update(data.raw).digest('hex') });
    expect(() => provider.parseWebhook(Buffer.from(JSON.stringify(JSON.parse(data.raw.toString()))), data.signature)).toThrow(expect.objectContaining({ code: 'INVALID_WEBHOOK_SIGNATURE' }));
  });
  it('accepts signed refund evidence without an optional related payment entity', () => {
    const data = signed('refund.processed', { ...refund, status: 'processed', receipt: null });
    expect(new RazorpayProvider(options).parseWebhook(data.raw, data.signature).refund).toEqual({ ...normalized, status: 'processed', receipt: null });
  });
  it('accepts full-refund payment status without treating it as a new payment capture', () => {
    const data = signed('refund.processed', { ...refund, status: 'processed' }, { ...payment, status: 'refunded' });
    expect(new RazorpayProvider(options).parseWebhook(data.raw, data.signature).payment!.status).toBe('refunded');
  });
  it.each([
    ['refund.created', 'failed'], ['refund.processed', 'pending'], ['refund.processed', 'failed'], ['refund.failed', 'processed'], ['refund.failed', 'pending'],
  ])('rejects %s with incompatible %s status', (event, status) => {
    const data = signed(event, { ...refund, status });
    expect(() => new RazorpayProvider(options).parseWebhook(data.raw, data.signature)).toThrow(expect.objectContaining({ code: 'INVALID_WEBHOOK_PAYLOAD' }));
  });
  it.each([{ id: 'rfnd_bad/path' }, { payment_id: 'pay_bad?query' }, { amount: 0 }, { currency: 'inr' }, { receipt: undefined }, { entity: 'payment' }])('rejects malformed signed refund identity: %j', change => {
    const data = signed('refund.processed', { ...refund, status: 'processed', ...change });
    expect(() => new RazorpayProvider(options).parseWebhook(data.raw, data.signature)).toThrow(expect.objectContaining({ code: 'INVALID_WEBHOOK_PAYLOAD' }));
  });
  it.each([{ id: 'pay_other' }, { currency: 'USD' }, { amount: 24999 }, { status: 'failed', captured: false }])('rejects inconsistent related payment evidence: %j', change => {
    const data = signed('refund.processed', { ...refund, status: 'processed' }, { ...payment, ...change });
    expect(() => new RazorpayProvider(options).parseWebhook(data.raw, data.signature)).toThrow(expect.objectContaining({ code: 'INVALID_WEBHOOK_PAYLOAD' }));
  });
  it('rejects a signed refund event missing its refund entity', () => {
    const raw = Buffer.from(JSON.stringify({ event: 'refund.processed', payload: { payment: { entity: payment } } }));
    const signature = createHmac('sha256', options.webhookSecret).update(raw).digest('hex');
    expect(() => new RazorpayProvider(options).parseWebhook(raw, signature)).toThrow(expect.objectContaining({ code: 'INVALID_WEBHOOK_PAYLOAD' }));
  });
  it('verifies signatures before parsing refund bytes and requires the separate webhook secret', () => {
    const provider = new RazorpayProvider(options);
    expect(() => provider.parseWebhook(Buffer.from('not JSON'), '0'.repeat(64))).toThrow(expect.objectContaining({ code: 'INVALID_WEBHOOK_SIGNATURE' }));
    const data = signed('refund.processed', { ...refund, status: 'processed' });
    const apiSignature = createHmac('sha256', options.keySecret).update(data.raw).digest('hex');
    expect(() => provider.parseWebhook(data.raw, apiSignature)).toThrow(expect.objectContaining({ code: 'INVALID_WEBHOOK_SIGNATURE' }));
  });
});
