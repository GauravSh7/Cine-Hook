import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../errors/app-error.js';

export function validateBody(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Do not include raw input or schema issue data, which may contain passwords.
      next(new AppError(400, 'VALIDATION_ERROR', 'Request fields are invalid.'));
      return;
    }
    req.body = result.data;
    next();
  };
}
