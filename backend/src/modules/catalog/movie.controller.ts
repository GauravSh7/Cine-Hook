import type { RequestHandler } from 'express';
import type { MovieService } from './movie.service.js';

export class MovieController {
  constructor(private readonly service: MovieService) {}
  list: RequestHandler = async (_req, res) => { res.json({ success: true, data: await this.service.list(res.locals.validatedQuery) }); };
  get: RequestHandler = async (_req, res) => { res.json({ success: true, data: { movie: await this.service.getById(res.locals.validatedParams.id, res.locals.validatedQuery.cityId) } }); };
  dates: RequestHandler = async (_req, res) => { res.json({ success: true, data: await this.service.showDates(res.locals.validatedParams.id, res.locals.validatedQuery.cityId) }); };
  create: RequestHandler = async (req, res) => { res.status(201).json({ success: true, data: { movie: await this.service.create(req.body) } }); };
  update: RequestHandler = async (req, res) => { res.json({ success: true, data: { movie: await this.service.update(res.locals.validatedParams.id, req.body) } }); };
  disable: RequestHandler = async (_req, res) => { res.json({ success: true, data: { movie: await this.service.disable(res.locals.validatedParams.id) } }); };
}
