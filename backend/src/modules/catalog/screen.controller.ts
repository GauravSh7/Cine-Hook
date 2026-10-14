import type { RequestHandler } from 'express';
import type { ScreenService } from './screen.service.js';

export class ScreenController {
  constructor(private readonly service: ScreenService) {}
  create: RequestHandler = async (req, res) => { res.status(201).json({ success: true, data: { screen: await this.service.create(req.body) } }); };
  update: RequestHandler = async (req, res) => { res.json({ success: true, data: { screen: await this.service.update(res.locals.validatedParams.id, req.body) } }); };
}
