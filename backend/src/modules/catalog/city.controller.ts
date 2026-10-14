import type { RequestHandler } from 'express';
import type { CityService } from './city.service.js';

export class CityController {
  constructor(private readonly service: CityService) {}
  list: RequestHandler = async (_req, res) => { res.json({ success: true, data: await this.service.list(res.locals.validatedQuery) }); };
  create: RequestHandler = async (req, res) => { res.status(201).json({ success: true, data: { city: await this.service.create(req.body) } }); };
}
