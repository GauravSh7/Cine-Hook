import type { Request, Response } from 'express';
import type { EventCatalog, EventQuery, EventSessionQuery } from './event.types.js';
export class EventController {
  constructor(private readonly events: EventCatalog) {}
  list = async (_req: Request, res: Response) => { res.json({ success: true, data: await this.events.list(res.locals.validatedQuery as EventQuery) }); };
  get = async (_req: Request, res: Response) => { res.json({ success: true, data: { event: await this.events.getById(res.locals.validatedParams.id as string) } }); };
  listSessions = async (_req: Request, res: Response) => { res.json({ success: true, data: await this.events.listSessions(res.locals.validatedQuery as EventSessionQuery) }); };
  getSession = async (_req: Request, res: Response) => { res.json({ success: true, data: { session: await this.events.getSessionById(res.locals.validatedParams.id as string) } }); };
}
