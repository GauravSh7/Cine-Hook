import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors/app-error.js';
import { validateBody } from '../../middleware/validate-body.js';
import { registerSchema } from './auth.validation.js';
import type { PasswordResetService } from './password-reset.service.js';
import { PasswordResetController } from './password-reset.controller.js';

export function passwordResetRoutes(origin: string, service?: PasswordResetService) {
  const router = Router();
  const controller = new PasswordResetController(service);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use((req, _res, next) => {
    if (['/forgot-password', '/reset-password'].includes(req.path) && req.headers.origin && req.headers.origin !== origin) {
      throw new AppError(403, 'FORBIDDEN', 'Request origin is not allowed.');
    }
    next();
  });
  router.post('/forgot-password', validateBody(z.object({ email: registerSchema.shape.email }).strict()), controller.request);
  router.post('/reset-password', validateBody(z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password: registerSchema.shape.password }).strict()), controller.reset);
  return router;
}
