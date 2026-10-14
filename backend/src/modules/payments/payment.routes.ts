import { Router, raw } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireCurrentUser } from '../../middleware/require-current-user.js';
import { validateBody } from '../../middleware/validate-body.js';
import type { AuthService } from '../auth/auth.service.js';
import type { TokenService } from '../auth/token.service.js';
import type { PaymentServices } from './payment.types.js';
import { PaymentController } from './payment.controller.js';
import { paymentOrderSchema, paymentVerifySchema } from './payment.validation.js';

export function paymentRoutes(services: PaymentServices, auth: { service: AuthService; tokens: TokenService }) {
  const router = Router(); const controller = new PaymentController(services.payments);
  const protect = [authMiddleware(auth.tokens), requireCurrentUser(auth.service)];
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.post('/order', ...protect, validateBody(paymentOrderSchema), controller.order);
  router.post('/verify', ...protect, validateBody(paymentVerifySchema), controller.verify);
  return router;
}
export function razorpayWebhookRoutes(services: PaymentServices) {
  const router = Router(); const controller = new PaymentController(services.payments);
  router.post('/razorpay', raw({ type: 'application/json', limit: '100kb', inflate: false }), controller.webhook);
  return router;
}
