import { Router } from 'express';
import { validateRequest } from '../../middleware/validate-request.js';
import { idSchema } from '../catalog/catalog.validation.js';
import type { EventCatalog } from './event.types.js';
import { EventController } from './event.controller.js';
import { eventQuerySchema, eventSessionQuerySchema } from './event.validation.js';
export function eventRoutes(events: EventCatalog) {
  const router = Router();
  const controller = new EventController(events);
  router.get('/events', validateRequest(eventQuerySchema, 'query'), controller.list);
  router.get('/events/:id', validateRequest(idSchema, 'params'), controller.get);
  router.get('/event-sessions', validateRequest(eventSessionQuerySchema, 'query'), controller.listSessions);
  router.get('/event-sessions/:id', validateRequest(idSchema, 'params'), controller.getSession);
  return router;
}
