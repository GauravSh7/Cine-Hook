import type { Request, Response } from 'express';
import type { MovieQuery, Page } from '../catalog/catalog.types.js';
import type { ShowQuery } from '../shows/show.types.js';
import type { BookingReadQuery } from './ui-read.types.js';
import type { UiReadService } from './ui-read.service.js';

export class UiReadController {
  constructor(private readonly reads: UiReadService) {}
  bookingSummary = async (_req: Request, res: Response) => {
    res.json({ success: true, data: await this.reads.bookingSummary(res.locals.identity.userId as string, res.locals.validatedParams.id as string) });
  };
  dashboard = async (_req: Request, res: Response) => { res.json({ success: true, data: await this.reads.dashboard() }); };
  movies = async (_req: Request, res: Response) => { res.json({ success: true, data: await this.reads.movies(res.locals.validatedQuery as MovieQuery) }); };
  shows = async (_req: Request, res: Response) => { res.json({ success: true, data: await this.reads.shows(res.locals.validatedQuery as ShowQuery) }); };
  bookings = async (_req: Request, res: Response) => { res.json({ success: true, data: await this.reads.bookings(res.locals.validatedQuery as BookingReadQuery) }); };
  payments = async (_req: Request, res: Response) => { res.json({ success: true, data: await this.reads.payments(res.locals.validatedQuery as Page) }); };
}
