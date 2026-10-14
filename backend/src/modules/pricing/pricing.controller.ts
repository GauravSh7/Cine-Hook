import type { Request, Response } from 'express';
import type { PricingService } from './pricing.service.js';
export class PricingController {
  constructor(private readonly service: PricingService) {}
  quote = async (_req:Request,res:Response) => { res.setHeader('Cache-Control','no-store'); res.json({success:true,data:await this.service.quote(res.locals.identity.userId,res.locals.validatedParams.id)}); };
  coupon = async (req:Request,res:Response) => { res.setHeader('Cache-Control','no-store'); res.json({success:true,data:await this.service.coupon(res.locals.identity.userId,res.locals.validatedParams.id,req.body.code)}); };
}
