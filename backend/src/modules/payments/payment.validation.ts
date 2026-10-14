import { z } from 'zod';

const bookingId = z.string().uuid().toLowerCase();
export const paymentOrderSchema = z.object({ bookingId }).strict();
export const paymentVerifySchema = z.object({ bookingId,
  razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]{1,64}$/),
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]{1,64}$/),
  razorpay_signature: z.string().regex(/^[A-Fa-f0-9]{64}$/),
}).strict();
