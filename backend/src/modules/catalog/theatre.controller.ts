import type { RequestHandler } from 'express';
import type { TheatreService } from './theatre.service.js';

export class TheatreController {
  constructor(private readonly service: TheatreService) {}
  list: RequestHandler = async (_req, res) => { res.json({ success: true, data: await this.service.list(res.locals.validatedQuery) }); };
  get: RequestHandler = async (_req, res) => { res.json({ success: true, data: { theatre: await this.service.getById(res.locals.validatedParams.id) } }); };
  create: RequestHandler = async (req, res) => { res.status(201).json({ success: true, data: { theatre: await this.service.create(req.body) } }); };
  update: RequestHandler = async (req, res) => { res.json({ success: true, data: { theatre: await this.service.update(res.locals.validatedParams.id, req.body) } }); };
}
