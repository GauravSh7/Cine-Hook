import type { RequestHandler } from 'express';
import type { DemoCatalog } from './demo-catalog.types.js';
export class DemoCatalogController {
  constructor(private readonly service: DemoCatalog) {}
  list: RequestHandler = async (_req, res) => { res.json({ success: true, data: await this.service.list({ ...res.locals.validatedQuery, ...res.locals.validatedParams }) }); };
  get: RequestHandler = async (_req, res) => {
    const { kind, id } = res.locals.validatedParams;
    res.json({ success: true, data: await this.service.get(kind, id) });
  };
}
