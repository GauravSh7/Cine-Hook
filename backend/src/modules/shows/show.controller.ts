import type { Request, Response } from 'express';
import type { ShowService } from './show.service.js';
import type { ShowInput, ShowQuery } from './show.types.js';

export class ShowController {
  constructor(private readonly shows: ShowService) {}
  list = async (_req: Request, res: Response) => {
    res.json({ success: true, data: await this.shows.list(res.locals.validatedQuery as ShowQuery) });
  };
  get = async (_req: Request, res: Response) => {
    res.json({ success: true, data: { show: await this.shows.getById(res.locals.validatedParams.id as string) } });
  };
  getSeats = async (_req: Request, res: Response) => {
    res.json({ success: true, data: await this.shows.getSeats(res.locals.validatedParams.id as string) });
  };
  create = async (req: Request, res: Response) => {
    res.status(201).json({ success: true, data: { show: await this.shows.create(req.body as ShowInput) } });
  };
}
