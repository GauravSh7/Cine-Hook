import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { validateBody } from '../../middleware/validate-body.js';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';
import type { TokenService } from './token.service.js';
import { registerSchema, loginSchema } from './auth.validation.js';
import { googleRoutes, type GoogleAuth } from './google/google.routes.js';
import { passwordResetRoutes } from './password-reset.routes.js';
import type { PasswordResetService } from './password-reset.service.js';

export function authRoutes(service: AuthService, tokens: TokenService, origin: string, google?: GoogleAuth, recovery?: PasswordResetService) {
  const router = Router();
  const controller = new AuthController(service);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use('/google', googleRoutes(origin, google,{service,tokens}));
  router.use(passwordResetRoutes(origin, recovery));
  router.post('/register', validateBody(registerSchema), controller.register);
  router.post('/login', validateBody(loginSchema), controller.login);
  router.get('/me', authMiddleware(tokens), controller.me);
  return router;
}
