export type ProviderOrder = { id: string; receipt: string; amountPaise: number; currency: string; status: 'created' | 'attempted' | 'paid' };
export type ProviderPayment = { id: string; orderId: string; amountPaise: number; currency: string;
  status: 'created' | 'authorized' | 'captured' | 'failed' | 'refunded'; captured: boolean };
export type ProviderRefund = { id: string; paymentId: string; amountPaise: number; currency: string;
  receipt: string | null; status: 'pending' | 'processed' | 'failed' };
export type ProviderWebhook = { eventType: string; payment?: ProviderPayment; order?: ProviderOrder; refund?: ProviderRefund; digest: string };
export type CreateProviderOrder = { receipt: string; amountPaise: number; currency: string };
export type CreateProviderRefund = { paymentId: string; amountPaise: number; currency: string; receipt: string; idempotencyKey: string };

export interface PaymentProvider {
  readonly keyId: string;
  createOrder(input: CreateProviderOrder): Promise<ProviderOrder>;
  findOrder(receipt: string): Promise<ProviderOrder | null>;
  fetchOrder(id: string): Promise<ProviderOrder>;
  fetchPayment(id: string): Promise<ProviderPayment>;
  createRefund(input: CreateProviderRefund): Promise<ProviderRefund>;
  fetchRefund(id: string): Promise<ProviderRefund>;
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;
  parseWebhook(rawBody: Buffer, signature: string): ProviderWebhook;
}
