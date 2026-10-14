import { AppError } from '../../errors/app-error.js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { PaymentProvider, ProviderOrder, ProviderPayment, ProviderRefund, ProviderWebhook, CreateProviderOrder, CreateProviderRefund } from './payment-provider.js';

export type RazorpayOptions = { keyId: string; keySecret: string; webhookSecret: string };
const origin = 'https://api.razorpay.com';
const maximumBytes = 262144;
const timeoutMs = 2000;
const receiptSchema = z.string().min(1).max(40).regex(/^[\x20-\x7e]+$/);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const amountSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const orderIdSchema = z.string().regex(/^order_[A-Za-z0-9]{1,64}$/);
const paymentIdSchema = z.string().regex(/^pay_[A-Za-z0-9]{1,64}$/);
const refundIdSchema = z.string().regex(/^rfnd_[A-Za-z0-9]{1,64}$/);
const idempotencyKeySchema = z.string().uuid();
const orderSchema = z.object({ id: orderIdSchema, receipt: receiptSchema, amount: amountSchema,
  currency: currencySchema, status: z.enum(['created', 'attempted', 'paid']) });
const paymentSchema = z.object({ id: paymentIdSchema, order_id: orderIdSchema, amount: amountSchema,
  currency: currencySchema, status: z.enum(['created', 'authorized', 'captured', 'failed', 'refunded']), captured: z.boolean() })
  .refine(value => value.captured === (value.status === 'captured' || value.status === 'refunded'));
const refundSchema = z.object({ id: refundIdSchema, entity: z.literal('refund'), payment_id: paymentIdSchema,
  amount: amountSchema, currency: currencySchema, receipt: receiptSchema.nullable(), status: z.enum(['pending', 'processed', 'failed']) });
const responseInvalid = () => new AppError(502, 'PAYMENT_PROVIDER_RESPONSE_INVALID', 'Unable to verify the payment provider response.');
const unavailable = () => new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Payment provider is temporarily unavailable.');
const inputInvalid = () => new AppError(400, 'VALIDATION_ERROR', 'Invalid payment provider request.');
const webhookInvalid = () => new AppError(400, 'INVALID_WEBHOOK_PAYLOAD', 'Invalid payment webhook.');

function normalizeOrder(value: unknown): ProviderOrder {
  const parsed = orderSchema.safeParse(value); if (!parsed.success) throw responseInvalid();
  return { id: parsed.data.id, receipt: parsed.data.receipt, amountPaise: parsed.data.amount, currency: parsed.data.currency, status: parsed.data.status };
}
function normalizePayment(value: unknown): ProviderPayment {
  const parsed = paymentSchema.safeParse(value); if (!parsed.success) throw responseInvalid();
  return { id: parsed.data.id, orderId: parsed.data.order_id, amountPaise: parsed.data.amount,
    currency: parsed.data.currency, status: parsed.data.status, captured: parsed.data.captured };
}
function normalizeRefund(value: unknown): ProviderRefund {
  const parsed = refundSchema.safeParse(value); if (!parsed.success) throw responseInvalid();
  return { id: parsed.data.id, paymentId: parsed.data.payment_id, amountPaise: parsed.data.amount,
    currency: parsed.data.currency, receipt: parsed.data.receipt, status: parsed.data.status };
}
function validSignature(message: string | Buffer, signature: string, secret: string): boolean {
  if (typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(message).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export class RazorpayProvider implements PaymentProvider {
  readonly keyId: string;
  constructor(private readonly options: RazorpayOptions, private readonly transport: typeof fetch = fetch) {
    if ([options.keyId, options.keySecret, options.webhookSecret].some(value => typeof value !== 'string' || !value.trim() || value.length > 4096)) throw unavailable();
    this.keyId = options.keyId;
  }

  private async request(path: string, method = 'GET', body?: object, refundIdempotencyKey?: string): Promise<{ status: number; body: unknown }> {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(unavailable()); }, timeoutMs);
      });
      const operation = async () => {
        const response = await this.transport(`${origin}/v1${path}`, { method, redirect: 'error', signal: abort.signal,
          headers: { Authorization: `Basic ${Buffer.from(`${this.options.keyId}:${this.options.keySecret}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json',
            ...(refundIdempotencyKey ? { 'X-Refund-Idempotency': refundIdempotencyKey } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (response.redirected || (response.url && new URL(response.url).origin !== origin)) throw responseInvalid();
        const length = response.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) throw responseInvalid();
        if (!response.body) throw responseInvalid();
        reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let bytes = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maximumBytes) throw responseInvalid();
          chunks.push(chunk.value);
        }
        let payload: unknown;
        try { payload = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); }
        catch { throw responseInvalid(); }
        return { status: response.status, body: payload };
      };
      return await Promise.race([operation(), deadline]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    } finally {
      clearTimeout(timer);
      abort.abort();
      // A response stream's cancellation can itself stall; do not await it or
      // let cleanup bypass the externally enforced request deadline.
      if (reader) void reader.cancel().catch(() => {});
    }
  }

  async createOrder(input: CreateProviderOrder): Promise<ProviderOrder> {
    if (!receiptSchema.safeParse(input.receipt).success || !amountSchema.safeParse(input.amountPaise).success || !currencySchema.safeParse(input.currency).success) throw inputInvalid();
    const response = await this.request('/orders', 'POST', { receipt: input.receipt, amount: input.amountPaise, currency: input.currency, partial_payment: false });
    let order: ProviderOrder;
    if (response.status === 400) {
      const error = z.object({ error: z.object({ code: z.literal('BAD_REQUEST_ERROR'), description: z.string().max(2000) }) }).safeParse(response.body);
      const duplicate = error.success && /duplicate request|receipt.*already|already.*receipt/i.test(error.data.error.description);
      if (!duplicate) throw responseInvalid();
      const recovered = await this.findOrder(input.receipt);
      if (!recovered) throw responseInvalid();
      order = recovered;
    } else {
      if (response.status < 200 || response.status >= 300) throw responseInvalid();
      order = normalizeOrder(response.body);
    }
    if (order.receipt !== input.receipt || order.amountPaise !== input.amountPaise || order.currency !== input.currency) throw responseInvalid();
    return order;
  }

  async findOrder(receipt: string): Promise<ProviderOrder | null> {
    if (!receiptSchema.safeParse(receipt).success) throw inputInvalid();
    const response = await this.request(`/orders?receipt=${encodeURIComponent(receipt)}&count=100`);
    if (response.status < 200 || response.status >= 300) throw responseInvalid();
    const collection = z.object({ items: z.array(z.unknown()).max(100) }).safeParse(response.body);
    if (!collection.success) throw responseInvalid();
    const matches = collection.data.items.filter(value => typeof value === 'object' && value !== null && 'receipt' in value && value.receipt === receipt);
    if (matches.length > 1 || (!matches.length && collection.data.items.length === 100)) throw responseInvalid();
    return matches.length ? normalizeOrder(matches[0]) : null;
  }

  async fetchOrder(id: string): Promise<ProviderOrder> {
    if (!orderIdSchema.safeParse(id).success) throw inputInvalid();
    const response = await this.request(`/orders/${id}`);
    if (response.status < 200 || response.status >= 300) throw responseInvalid();
    const order = normalizeOrder(response.body); if (order.id !== id) throw responseInvalid();
    return order;
  }

  async fetchPayment(id: string): Promise<ProviderPayment> {
    if (!paymentIdSchema.safeParse(id).success) throw inputInvalid();
    const response = await this.request(`/payments/${id}`);
    if (response.status < 200 || response.status >= 300) throw responseInvalid();
    const payment = normalizePayment(response.body); if (payment.id !== id) throw responseInvalid();
    return payment;
  }

  async createRefund(input: CreateProviderRefund): Promise<ProviderRefund> {
    const { paymentId, amountPaise, currency, receipt, idempotencyKey } = input;
    if (!paymentIdSchema.safeParse(paymentId).success || !amountSchema.safeParse(amountPaise).success ||
        !currencySchema.safeParse(currency).success || !receiptSchema.safeParse(receipt).success ||
        !idempotencyKeySchema.safeParse(idempotencyKey).success) throw inputInvalid();
    // Razorpay inherits currency from the captured payment. Sending it in the
    // body is unsupported; verify the returned currency against trusted input.
    const response = await this.request(`/payments/${paymentId}/refund`, 'POST',
      { amount: amountPaise, speed: 'normal', receipt }, idempotencyKey);
    if (response.status < 200 || response.status >= 300) throw responseInvalid();
    const refund = normalizeRefund(response.body);
    if (refund.paymentId !== paymentId || refund.amountPaise !== amountPaise ||
        refund.currency !== currency || refund.receipt !== receipt) throw responseInvalid();
    return refund;
  }

  async fetchRefund(id: string): Promise<ProviderRefund> {
    if (!refundIdSchema.safeParse(id).success) throw inputInvalid();
    const response = await this.request(`/refunds/${id}`);
    if (response.status < 200 || response.status >= 300) throw responseInvalid();
    const refund = normalizeRefund(response.body); if (refund.id !== id) throw responseInvalid();
    return refund;
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!orderIdSchema.safeParse(orderId).success || !paymentIdSchema.safeParse(paymentId).success) return false;
    return validSignature(`${orderId}|${paymentId}`, signature, this.options.keySecret);
  }

  parseWebhook(rawBody: Buffer, signature: string): ProviderWebhook {
    if (!Buffer.isBuffer(rawBody) || !validSignature(rawBody, signature, this.options.webhookSecret)) {
      throw new AppError(400, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid payment webhook signature.');
    }
    if (rawBody.length > maximumBytes) throw webhookInvalid();
    let body: unknown;
    try { body = JSON.parse(rawBody.toString('utf8')); } catch { throw webhookInvalid(); }
    const envelope = z.object({ event: z.string().min(1).max(100), payload: z.unknown().optional() }).safeParse(body);
    if (!envelope.success) throw webhookInvalid();
    const eventType = envelope.data.event, digest = createHash('sha256').update(rawBody).digest('hex');
    if (['refund.created', 'refund.processed', 'refund.failed'].includes(eventType)) {
      const payload = z.object({ refund: z.object({ entity: z.unknown() }), payment: z.object({ entity: z.unknown() }).optional() }).safeParse(envelope.data.payload);
      if (!payload.success) throw webhookInvalid();
      try {
        const refund = normalizeRefund(payload.data.refund.entity);
        // A created refund may already have finished processing (normal refund
        // examples document this); completion and failure events are exact.
        if ((eventType === 'refund.created' && refund.status === 'failed') ||
            (eventType === 'refund.processed' && refund.status !== 'processed') ||
            (eventType === 'refund.failed' && refund.status !== 'failed')) throw webhookInvalid();
        if (!payload.data.payment) return { eventType, refund, digest };
        const payment = normalizePayment(payload.data.payment.entity);
        if (!payment.captured || payment.id !== refund.paymentId || payment.currency !== refund.currency ||
            payment.amountPaise < refund.amountPaise) throw webhookInvalid();
        return { eventType, refund, payment, digest };
      } catch { throw webhookInvalid(); }
    }
    if (!['payment.captured', 'order.paid', 'payment.failed'].includes(eventType)) return { eventType, digest };
    const payload = z.object({ payment: z.object({ entity: z.unknown() }), order: z.object({ entity: z.unknown() }).optional() }).safeParse(envelope.data.payload);
    if (!payload.success) throw webhookInvalid();
    try {
      const payment = normalizePayment(payload.data.payment.entity);
      if (eventType === 'payment.failed') {
        if (payment.status !== 'failed' || payment.captured) throw webhookInvalid();
        return { eventType, payment, digest };
      }
      if (payment.status !== 'captured' || !payment.captured) throw webhookInvalid();
      if (eventType === 'payment.captured') return { eventType, payment, digest };
      const order = normalizeOrder(payload.data.order?.entity);
      if (order.status !== 'paid' || order.id !== payment.orderId || order.amountPaise !== payment.amountPaise || order.currency !== payment.currency) throw webhookInvalid();
      return { eventType, payment, order, digest };
    } catch { throw webhookInvalid(); }
  }
}
