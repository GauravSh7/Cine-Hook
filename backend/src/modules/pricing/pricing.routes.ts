import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireCurrentUser } from '../../middleware/require-current-user.js';
import { validateBody } from '../../middleware/validate-body.js';
import { validateRequest } from '../../middleware/validate-request.js';
import type { AuthService } from '../auth/auth.service.js';
import type { TokenService } from '../auth/token.service.js';
import { idSchema } from '../catalog/catalog.validation.js';
import type { PricingService } from './pricing.service.js';
import { PricingController } from './pricing.controller.js';
export function pricingRoutes(service:PricingService,auth:{service:AuthService;tokens:TokenService}) {
  const router = Router(), c = new PricingController(service);
  const protect = [authMiddleware(auth.tokens),requireCurrentUser(auth.service),validateRequest(idSchema,'params')];
  router.get('/bookings/:id/quote',...protect,c.quote);
  router.put('/bookings/:id/coupon',...protect,validateBody(z.object({code:z.string().trim().toUpperCase().max(20).nullable()}).strict()),c.coupon);
  return router;
}
