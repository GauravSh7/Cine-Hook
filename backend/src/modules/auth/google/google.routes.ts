import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../../errors/app-error.js';
import { validateBody } from '../../../middleware/validate-body.js';
import { GoogleAuthController } from './google.controller.js';
import { googleRequest, validateGoogleChallenge } from './google.middleware.js';
import type { GoogleAuthService } from './google.service.js';
import type { GoogleChallenge } from './google.challenge.js';
import {authMiddleware} from '../../../middleware/auth.middleware.js';
import {requireCurrentUser} from '../../../middleware/require-current-user.js';
import type {AuthService} from '../auth.service.js';
import type {TokenService} from '../token.service.js';
export interface GoogleAuth { service: GoogleAuthService; challenge: GoogleChallenge }
export function googleRoutes(origin: string, auth?: GoogleAuth, session?:{service:AuthService;tokens:TokenService}) {
  const router = Router(), controller = new GoogleAuthController(auth?.service, auth?.challenge);
  router.get('/config', controller.config);
  router.use(googleRequest(origin, auth?.challenge));
  router.use((_req, _res, next) => { if (!auth) return next(new AppError(503, 'GOOGLE_UNAVAILABLE', 'Google sign-in is not configured. Please use email and password.')); auth.service.requireConfigured(); next(); });
  router.post('/challenge', validateBody(z.object({}).strict()), controller.begin);
  if (auth) router.post('/', validateBody(z.object({ credential: z.string().min(1).max(16384), csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict()), validateGoogleChallenge(auth.challenge), controller.login);
  if(auth && session) router.post('/link',authMiddleware(session.tokens),requireCurrentUser(session.service),validateBody(z.object({
    credential:z.string().min(1).max(16384),csrfToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),password:z.string().min(1).max(72).refine(v=>Buffer.byteLength(v,'utf8')<=72),
  }).strict()),validateGoogleChallenge(auth.challenge),controller.link);
  return router;
}
