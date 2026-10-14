import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireCurrentUser } from '../../middleware/require-current-user.js';
import { validateBody } from '../../middleware/validate-body.js';
import { validateRequest } from '../../middleware/validate-request.js';
import type { AuthService } from '../auth/auth.service.js';
import type { TokenService } from '../auth/token.service.js';
import { idSchema, pageSchema } from '../catalog/catalog.validation.js';
import type { BookingServices } from './booking.types.js';
import { BookingController } from './booking.controller.js';
import { bookingCreateSchema } from './booking.validation.js';

export function bookingRoutes(services: BookingServices, auth: { service: AuthService; tokens: TokenService },cancelCheckout?:(userId:string,id:string)=>Promise<unknown>) {
  const router = Router();
  const booking = new BookingController(services.bookings,cancelCheckout);
  const id = validateRequest(idSchema, 'params');
  const protectedRoute = [authMiddleware(auth.tokens), requireCurrentUser(auth.service)];
  router.use(['/bookings', '/shows/:id/availability'], (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/shows/:id/availability', id, booking.availability);
  router.post('/bookings', ...protectedRoute, validateBody(bookingCreateSchema), booking.create);
  router.get('/bookings', ...protectedRoute, validateRequest(pageSchema, 'query'), booking.list);
  router.get('/bookings/:id', ...protectedRoute, id, booking.get);
  router.delete('/bookings/:id/hold', ...protectedRoute, id, booking.releaseHold);
  return router;
}
