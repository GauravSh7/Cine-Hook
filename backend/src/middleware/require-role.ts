import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import type { AuthService } from '../modules/auth/auth.service.js';
import type { Identity, UserRole } from '../modules/auth/auth.types.js';

export function requireRole(role: UserRole, auth: AuthService): RequestHandler {
  return async (_req, res, next) => {
    const identity = res.locals.identity as Identity | undefined;
    if (!identity) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
    const user = res.locals.authUser ?? await auth.getMe(identity.userId);
    if (user.role !== role) throw new AppError(403, 'FORBIDDEN', 'You do not have permission for this action.');
    next();
  };
}
