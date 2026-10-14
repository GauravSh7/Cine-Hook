import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireCurrentUser } from '../../middleware/require-current-user.js';
import { requireRole } from '../../middleware/require-role.js';
import { validateRequest } from '../../middleware/validate-request.js';
import type { AuthService } from '../auth/auth.service.js';
import type { TokenService } from '../auth/token.service.js';
import { idSchema, movieQuerySchema, pageSchema } from '../catalog/catalog.validation.js';
import { showQuerySchema } from '../shows/show.validation.js';
import { UiReadController } from './ui-read.controller.js';
import type { UiReadServices } from './ui-read.types.js';

const bookingQuerySchema = pageSchema.extend({ search: z.string().trim().max(100).transform(value => value || undefined).optional() }).strict();
export function uiReadRoutes(services: UiReadServices, auth: { service: AuthService; tokens: TokenService }) {
  const router = Router();
  const controller = new UiReadController(services.reads);
  router.use(['/bookings/:id/summary', '/admin'], (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/bookings/:id/summary', authMiddleware(auth.tokens), requireCurrentUser(auth.service),
    validateRequest(idSchema, 'params'), validateRequest(z.object({}).strict(), 'query'), controller.bookingSummary);
  const admin = Router();
  admin.use(authMiddleware(auth.tokens), requireRole('ADMIN', auth.service));
  admin.get('/dashboard', validateRequest(z.object({}).strict(), 'query'), controller.dashboard);
  admin.get('/movies', validateRequest(movieQuerySchema, 'query'), controller.movies);
  admin.get('/shows', validateRequest(showQuerySchema, 'query'), controller.shows);
  admin.get('/bookings', validateRequest(bookingQuerySchema, 'query'), controller.bookings);
  admin.get('/payments', validateRequest(pageSchema, 'query'), controller.payments);
  router.use('/admin', admin);
  return router;
}
