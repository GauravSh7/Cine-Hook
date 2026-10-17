import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AppError } from '../../errors/app-error.js';
import type { Identity } from './auth.types.js';
import type { SessionGuard } from './password-reset.types.js';
import { credentialTag } from './password-credential.js';

const claimsSchema = z.object({
  userId: z.string().uuid(), role: z.enum(['USER', 'ADMIN']),
  iat: z.number().int().nonnegative(), exp: z.number().int().positive(),
  authTimeMs: z.number().int().nonnegative().optional(),
  credentialTag: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  iss: z.literal('cinehook'), aud: z.literal('cinehook-api'),
}).strict();

export class TokenService {
  constructor(private readonly options: { secret: string; expiresInSeconds: number; sessions?: SessionGuard }) {}

  sign(identity: Identity, authenticatedAtMs = Date.now(), passwordHash?: string): string {
    return jwt.sign({ userId: identity.userId, role: identity.role,
      ...(this.options.sessions ? { authTimeMs: authenticatedAtMs, ...(passwordHash ? { credentialTag: credentialTag(this.options.secret, passwordHash) } : {}) } : {}) }, this.options.secret, {
      algorithm: 'HS256', expiresIn: this.options.expiresInSeconds,
      issuer: 'cinehook', audience: 'cinehook-api',
    });
  }

  async verifySession(token: string): Promise<Identity> {
    const identity = this.verify(token);
    if (this.options.sessions) {
      const claims = jwt.decode(token) as jwt.JwtPayload;
      if (!await this.options.sessions.valid(identity.userId, typeof claims.authTimeMs === 'number' ? claims.authTimeMs : claims.iat! * 1000,
        typeof claims.credentialTag === 'string' ? claims.credentialTag : undefined)) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
      }
    }
    return identity;
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
