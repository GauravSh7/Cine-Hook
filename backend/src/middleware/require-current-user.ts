import type { RequestHandler } from 'express';
import type { AuthService } from '../modules/auth/auth.service.js';
import { AppError } from '../errors/app-error.js';

export function requireCurrentUser(auth: AuthService): RequestHandler {
  return async (_req, res, next) => {
    if (!res.locals.identity) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
    const user = res.locals.authUser ?? await auth.getMe(res.locals.identity.userId as string);
    res.locals.identity = { userId: user.id, role: user.role };
    next();
  };
}
