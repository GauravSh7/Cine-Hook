import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/require-role.js';
import { validateBody } from '../../middleware/validate-body.js';
import { validateRequest } from '../../middleware/validate-request.js';
import type { AuthService } from '../auth/auth.service.js';
import type { TokenService } from '../auth/token.service.js';
import { idSchema } from '../catalog/catalog.validation.js';
import type { ShowServices } from './show.types.js';
import { ShowController } from './show.controller.js';
import { SeatController } from './seat.controller.js';
import { layoutSchema, showCreateSchema, showQuerySchema } from './show.validation.js';

export function showRoutes(services: ShowServices, auth: { service: AuthService; tokens: TokenService }) {
  const router = Router();
  const show = new ShowController(services.shows);
  const seat = new SeatController(services.seats);
  const id = validateRequest(idSchema, 'params');
  const admin = [authMiddleware(auth.tokens), requireRole('ADMIN', auth.service)];
  router.get('/shows', validateRequest(showQuerySchema, 'query'), show.list);
  router.get('/shows/:id', id, show.get);
  router.get('/shows/:id/seats', id, show.getSeats);
  router.get('/screens/:id/seats', id, seat.list);
  router.post('/admin/shows', ...admin, validateBody(showCreateSchema), show.create);
  router.post('/admin/screens/:id/seats', ...admin, id, validateBody(layoutSchema), seat.initialize);
  return router;
}
