import type { RequestHandler } from 'express';
import { AppError } from '../../../errors/app-error.js';
import type { GoogleChallenge } from './google.challenge.js';
export function googleRequest(origin: string, challenge?: GoogleChallenge): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'POST') return next();
    if (req.headers.origin !== origin) return next(new AppError(403, 'GOOGLE_ORIGIN_INVALID', 'Google sign-in requires a trusted origin.'));
    if (challenge && (req.path === '/' || req.path==='/link') && !res.locals.googleCookieCleared) { challenge.clear(res); res.locals.googleCookieCleared = true; }
    if (!req.is('application/json')) return next(new AppError(415, 'GOOGLE_CONTENT_INVALID', 'Google sign-in requires JSON.'));
    next();
  };
}
export function validateGoogleChallenge(challenge: GoogleChallenge): RequestHandler {
  return (req, res, next) => { try { res.locals.googleNonce = challenge.verify(req.headers.cookie, req.body.csrfToken); next(); } catch (error) { next(error); } };
}
