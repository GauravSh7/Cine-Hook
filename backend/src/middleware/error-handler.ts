import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) { next(error); return; }
  const bodyError = error as { type?: string } | null;
  const known = error instanceof AppError ? error
    : bodyError?.type === 'entity.parse.failed'
      ? new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON.')
      : bodyError?.type === 'entity.too.large'
        ? new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
        : new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  if (known.status >= 500) {
    // No raw exception values: third-party errors can contain credentials.
    console.error(JSON.stringify({ event: 'request_failed', requestId: res.locals.requestId, code: known.code }));
  }
  res.status(known.status).json({
    success: false,
    error: { code: known.code, message: known.message, requestId: res.locals.requestId },
  });
};
