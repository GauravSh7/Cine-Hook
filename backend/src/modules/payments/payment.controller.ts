import type { Request, Response } from 'express';
import type { PaymentService } from './payment.service.js';
import type { PaymentVerification } from './payment.types.js';

export class PaymentController {
  constructor(private readonly payments: PaymentService) {}
  order = async (req: Request, res: Response) => {
    res.status(201).json({ success: true, data: await this.payments.order(res.locals.identity.userId as string, req.body.bookingId as string) });
  };
  verify = async (req: Request, res: Response) => {
    res.json({ success: true, data: await this.payments.verify(res.locals.identity.userId as string, req.body as PaymentVerification) });
  };
  webhook = async (req: Request, res: Response) => {
    res.json(await this.payments.webhook(req.body as Buffer, req.get('X-Razorpay-Signature') ?? '', req.get('X-Razorpay-Event-Id') ?? ''));
  };
}
