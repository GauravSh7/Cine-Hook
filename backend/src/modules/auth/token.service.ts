import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AppError } from '../../errors/app-error.js';
import type { Identity } from './auth.types.js';

const claimsSchema = z.object({
  userId: z.string().uuid(), role: z.enum(['USER', 'ADMIN']),
  iat: z.number().int().nonnegative(), exp: z.number().int().positive(),
  iss: z.literal('cinehook'), aud: z.literal('cinehook-api'),
}).strict();

export class TokenService {
  constructor(private readonly options: { secret: string; expiresInSeconds: number }) {}

  sign(identity: Identity): string {
    return jwt.sign({ userId: identity.userId, role: identity.role }, this.options.secret, {
      algorithm: 'HS256', expiresIn: this.options.expiresInSeconds,
      issuer: 'cinehook', audience: 'cinehook-api',
    });
  }

  verify(token: string): Identity {
    try {
      const claims = claimsSchema.parse(jwt.verify(token, this.options.secret, {
        algorithms: ['HS256'], issuer: 'cinehook', audience: 'cinehook-api',
      }));
      return { userId: claims.userId, role: claims.role };
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
    }
  }
}
