import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors/app-error.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireCurrentUser } from '../../middleware/require-current-user.js';
import { validateRequest } from '../../middleware/validate-request.js';
import { idSchema, pageSchema } from '../catalog/catalog.validation.js';
import type { AuthService } from '../auth/auth.service.js';
import type { TokenService } from '../auth/token.service.js';
import { WishlistController } from './wishlist.controller.js';
import type { WishlistService } from './wishlist.service.js';
export function wishlistRoutes(service: WishlistService, auth: { service: AuthService; tokens: TokenService }) {
  const router = Router(); const controller = new WishlistController(service);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(authMiddleware(auth.tokens), requireCurrentUser(auth.service));
  router.get('/movies', validateRequest(pageSchema, 'query'), controller.list);
  const empty = z.object({}).strict();
  router.use('/movies/:id', validateRequest(idSchema, 'params'), (req, _res, next) => {
    const unparsedBody = req.body === undefined && (Number(req.headers['content-length'] ?? 0) > 0 || !!req.headers['transfer-encoding']);
    if (unparsedBody || !empty.safeParse(req.body ?? {}).success || !empty.safeParse(req.query).success) return next(new AppError(400, 'VALIDATION_ERROR', 'No owner or movie fields are accepted.'));
    next();
  });
  router.get('/movies/:id', controller.status);
  router.put('/movies/:id', controller.save);
  router.delete('/movies/:id', controller.remove);
  return router;
}
