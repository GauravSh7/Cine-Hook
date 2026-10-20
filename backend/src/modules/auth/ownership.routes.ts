import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors/app-error.js';
import { validateBody } from '../../middleware/validate-body.js';
import { registerSchema, loginSchema } from './auth.validation.js';
import { proofPurpose } from './ownership-proof.store.js';
import { OwnershipController } from './ownership.controller.js';
import type { OwnershipService } from './ownership.service.js';

export function ownershipRoutes(service: OwnershipService, origin: string) {
  const router = Router(), controller = new OwnershipController(service);
  const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
  router.use((req, _res, next) => {
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== origin) throw new AppError(403, 'FORBIDDEN', 'Request origin is not allowed.');
    next();
  });
  router.post('/ownership/request', validateBody(z.object({ purpose: proofPurpose, email: registerSchema.shape.email }).strict()), controller.request);
  const verify = z.object({ challengeId: token, otp: z.string().regex(/^\d{6}$/) }).strict();
  router.post('/ownership/verify', validateBody(verify), controller.verify);
  router.post('/ownership/complete', validateBody(z.object({ purpose: proofPurpose, token, password: registerSchema.shape.password,
    name: registerSchema.shape.name.optional(), currentPassword: loginSchema.shape.password.optional(), cleanStartConfirmed: z.boolean().optional() }).strict()), controller.complete);
  router.post('/forgot-password', validateBody(z.object({ email: registerSchema.shape.email }).strict()), controller.requestReset);
  router.post('/verify-reset-otp', validateBody(verify), controller.verify);
  router.post('/reset-password', validateBody(z.object({ token, password: registerSchema.shape.password }).strict()), controller.reset);
  return router;
}
