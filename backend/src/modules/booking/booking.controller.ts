import type { Request, Response } from 'express';
import type { BookingServices } from './booking.types.js';
import type { BookingInput } from './booking.types.js';
import type { Page } from '../catalog/catalog.types.js';

export class BookingController {
  constructor(private readonly bookings: BookingServices['bookings'],private readonly cancelCheckout?:(userId:string,id:string)=>Promise<unknown>) {}
  create = async (req: Request, res: Response) => {
    res.status(201).json({ success: true, data: { booking: await this.bookings.create(res.locals.identity.userId as string, req.body as BookingInput) } });
  };
  get = async (_req: Request, res: Response) => {
    res.json({ success: true, data: { booking: await this.bookings.getById(res.locals.identity.userId as string, res.locals.validatedParams.id as string) } });
  };
  list = async (_req: Request, res: Response) => {
    res.json({ success: true, data: await this.bookings.list(res.locals.identity.userId as string, res.locals.validatedQuery as Page) });
  };
  releaseHold = async (_req: Request, res: Response) => {
    const owner=res.locals.identity.userId as string,id=res.locals.validatedParams.id as string;
    if(this.cancelCheckout) {
      await this.cancelCheckout(owner,id);
      res.json({success:true,data:{booking:await this.bookings.getById(owner,id)}});
    } else res.json({ success: true, data: { booking: await this.bookings.releaseHold(owner,id) } });
  };
  availability = async (_req: Request, res: Response) => {
    res.json({ success: true, data: await this.bookings.availability(res.locals.validatedParams.id as string) });
  };
}
