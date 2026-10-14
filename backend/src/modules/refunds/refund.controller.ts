import type { Request, Response } from 'express';
import type { RefundService } from './refund.service.js';

export class RefundController {
  constructor(private readonly refunds: RefundService) {}
  private status(data: Awaited<ReturnType<RefundService['get']>>) {
    return data.refunds.some(refund => refund.status === 'PENDING') || data.payment.status === 'REFUND_PENDING' ? 202 : 200;
  }
  cancel = async (_req: Request, res: Response) => {
    const data = await this.refunds.cancel(res.locals.identity.userId as string, res.locals.validatedParams.id as string);
    res.status(this.status(data)).json({ success: true, data });
  };
  cancelCheckout = async (_req:Request,res:Response)=>{
    res.json({success:true,data:await this.refunds.cancelCheckout(res.locals.identity.userId as string,res.locals.validatedParams.id as string)});
  };
  retry = async (_req: Request, res: Response) => {
    const data = await this.refunds.retry(res.locals.identity.userId as string, res.locals.validatedParams.id as string);
    res.status(this.status(data)).json({ success: true, data });
  };
  get = async (_req: Request, res: Response) => {
    res.json({ success: true, data: await this.refunds.get(res.locals.identity.userId as string, res.locals.validatedParams.id as string) });
  };
  reconcile = async (_req: Request, res: Response) => { res.json({ success: true, data: await this.refunds.reconcileBatch() }); };
}
