import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import type { TokenService } from '../modules/auth/token.service.js';

export function authMiddleware(tokens: TokenService): RequestHandler {
  return (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '');
    if (!match?.[1]) {
      next(new AppError(401, 'UNAUTHORIZED', 'Authentication is required.'));
      return;
    }
    try {
      // Request-local identity only; no shared session/auth state in this process.
      res.locals.identity = tokens.verify(match[1]);
      next();
    } catch (error) { next(error); }
  };
}
