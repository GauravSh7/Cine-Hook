import type { RequestHandler } from 'express';
import type { WishlistService } from './wishlist.service.js';
export class WishlistController {
  constructor(private readonly service: WishlistService) {}
  list: RequestHandler = async (_req, res) => { res.json({ success: true, data: await this.service.list(res.locals.identity.userId, res.locals.validatedQuery) }); };
  status: RequestHandler = async (_req, res) => { res.json({ success: true, data: await this.service.status(res.locals.identity.userId, res.locals.validatedParams.id) }); };
  save: RequestHandler = async (_req, res) => { res.json({ success: true, data: await this.service.save(res.locals.identity.userId, res.locals.validatedParams.id) }); };
  remove: RequestHandler = async (_req, res) => { res.json({ success: true, data: await this.service.remove(res.locals.identity.userId, res.locals.validatedParams.id) }); };
}
