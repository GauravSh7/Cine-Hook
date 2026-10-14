import { api } from './client'
import type { OrderResult, Payment, PaymentVerification } from './types'

export const paymentApi = {
  order: (bookingId: string, signal?: AbortSignal) => api<OrderResult>('/payments/order', { method: 'POST', body: { bookingId }, signal }),
  verify: (input: PaymentVerification, signal?: AbortSignal) => api<{ payment: Payment }>('/payments/verify', { method: 'POST', signal, body: { bookingId: input.bookingId, razorpay_order_id: input.razorpay_order_id, razorpay_payment_id: input.razorpay_payment_id, razorpay_signature: input.razorpay_signature } }),
}
