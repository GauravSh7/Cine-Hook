import type { Request, Response } from 'express';
import { AppError } from '../../errors/app-error.js';
import type { EventBookingService } from './event-booking.service.js';
import type { EventBookingInput } from './event-booking.types.js';

export class EventBookingController {
  constructor(private readonly service?: EventBookingService) {}
  private available() {
    if (!this.service) throw new AppError(503, 'EVENT_BOOKINGS_UNAVAILABLE', 'Event booking is unavailable.');
    return this.service;
  }
  create = async (req: Request, res: Response) => {
    res.status(201).json({ success: true, data: { booking: await this.available().create(res.locals.identity.userId as string, req.body as EventBookingInput) } });
  };
  availability = async (_req: Request, res: Response) => {
    res.json({ success: true, data: await this.available().availability(res.locals.validatedParams.id as string) });
  };
}
