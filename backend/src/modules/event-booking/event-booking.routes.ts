import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireCurrentUser } from '../../middleware/require-current-user.js';
import { validateBody } from '../../middleware/validate-body.js';
import { validateRequest } from '../../middleware/validate-request.js';
import type { AuthService } from '../auth/auth.service.js';
import type { TokenService } from '../auth/token.service.js';
import { idSchema } from '../catalog/catalog.validation.js';
import type { EventBookingService } from './event-booking.service.js';
import { eventBookingCreateSchema } from './event-booking.validation.js';
import { EventBookingController } from './event-booking.controller.js';

export function eventBookingRoutes(service: EventBookingService | undefined, auth: { service: AuthService; tokens: TokenService }) {
  const router = Router();
  const controller = new EventBookingController(service);
  router.use(['/event-bookings', '/event-sessions/:id/availability'], (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.post('/event-bookings', authMiddleware(auth.tokens), requireCurrentUser(auth.service), validateBody(eventBookingCreateSchema), controller.create);
  router.get('/event-sessions/:id/availability', validateRequest(idSchema, 'params'), controller.availability);
  return router;
}
