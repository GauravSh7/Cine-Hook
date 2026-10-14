import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../errors/app-error.js';

export function validateRequest(schema: ZodType, target: 'params' | 'query'): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) { next(new AppError(400, 'VALIDATION_ERROR', 'Request parameters are invalid.')); return; }
    // Express 5 query is a getter: keep parsed values request-local instead.
    res.locals[target === 'params' ? 'validatedParams' : 'validatedQuery'] = result.data;
    next();
  };
}
