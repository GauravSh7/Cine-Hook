import type { Request, Response } from 'express';
import type { SeatService } from './seat.service.js';
import type { SeatInput } from './show.types.js';

export class SeatController {
  constructor(private readonly seats: SeatService) {}
  list = async (_req: Request, res: Response) => {
    res.json({ success: true, data: await this.seats.list(res.locals.validatedParams.id as string) });
  };
  initialize = async (req: Request, res: Response) => {
    const seats = await this.seats.initialize(res.locals.validatedParams.id as string, req.body.seats as SeatInput[]);
    res.status(201).json({ success: true, data: { seats } });
  };
}
