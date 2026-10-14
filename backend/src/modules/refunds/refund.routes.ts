import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireCurrentUser } from '../../middleware/require-current-user.js';
import { requireRole } from '../../middleware/require-role.js';
import { validateBody } from '../../middleware/validate-body.js';
import { validateRequest } from '../../middleware/validate-request.js';
import { idSchema } from '../catalog/catalog.validation.js';
import type { AuthService } from '../auth/auth.service.js';
import type { TokenService } from '../auth/token.service.js';
import type { RefundService } from './refund.service.js';
import { RefundController } from './refund.controller.js';

export function refundRoutes(refunds: RefundService, auth: { service: AuthService; tokens: TokenService }) {
  const router = Router(), controller = new RefundController(refunds);
  const protect = [authMiddleware(auth.tokens), requireCurrentUser(auth.service)];
  const id = validateRequest(idSchema, 'params'), empty = validateBody(z.object({}).strict());
  router.use(['/bookings', '/admin/refunds'], (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.post('/bookings/:id/cancel', ...protect, id, empty, controller.cancel);
  router.post('/bookings/:id/checkout/cancel', ...protect, id, empty, controller.cancelCheckout);
  router.post('/bookings/:id/refund/retry', ...protect, id, empty, controller.retry);
  router.get('/bookings/:id/refunds', ...protect, id, controller.get);
  router.post('/admin/refunds/reconcile', ...protect, requireRole('ADMIN', auth.service), empty, controller.reconcile);
  return router;
}
