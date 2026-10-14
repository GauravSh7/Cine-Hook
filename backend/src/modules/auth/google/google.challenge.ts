import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { CookieOptions, Response } from 'express';
import { AppError } from '../../../errors/app-error.js';

const claimSchema = z.object({ purpose: z.literal('cinehook-google-challenge-v1'), clientId: z.string().max(256), origin: z.string().max(2048),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/), csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), issuedAt: z.number().int(), expiresAt: z.number().int() }).strict();
const invalid = () => new AppError(403, 'GOOGLE_CHALLENGE_INVALID', 'Google sign-in expired or could not be validated. Please try again.');
export class GoogleChallenge {
  private readonly key: Buffer;
  private readonly name: string;
  private readonly cookieOptions: CookieOptions;
  constructor(private readonly options: { secret: string; clientId: string; origin: string; secure: boolean }) {
    this.key = createHmac('sha256', options.secret).update('cinehook:google-challenge:key:v1').digest();
    this.name = options.secure ? '__Secure-cinehook-google-challenge' : 'cinehook-google-challenge';
    this.cookieOptions = { httpOnly: true, secure: options.secure, sameSite: 'lax', path: '/api/auth/google' };
  }
  issue(res: Response) {
    const issuedAt = Math.floor(Date.now() / 1000), expiresAt = issuedAt + 300;
    const nonce = randomBytes(32).toString('base64url'), csrfToken = randomBytes(32).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ purpose: 'cinehook-google-challenge-v1', clientId: this.options.clientId, origin: this.options.origin, nonce, csrfToken, issuedAt, expiresAt })).toString('base64url');
    res.cookie(this.name, `${payload}.${this.sign(payload)}`, { ...this.cookieOptions, maxAge: 300000 });
    return { nonce, csrfToken, expiresAt };
  }
  clear(res: Response) { res.cookie(this.name, '', { ...this.cookieOptions, maxAge: 0 }); }
  verify(cookie: string | undefined, csrfToken: string) {
    try {
      const matches = (cookie ?? '').split(';').map(v => v.trim()).filter(v => v.split('=')[0] === this.name);
      if (matches.length !== 1 || matches[0]!.length > 4096) throw invalid();
      const value = matches[0]!.slice(this.name.length + 1), parts = value.split('.');
      if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]!)) throw invalid();
      const signature = Buffer.from(parts[1]!), expected = Buffer.from(this.sign(parts[0]!));
      if (!timingSafeEqual(signature, expected)) throw invalid();
      const claims = claimSchema.parse(JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'))), now = Math.floor(Date.now() / 1000);
      if (claims.clientId !== this.options.clientId || claims.origin !== this.options.origin || claims.csrfToken !== csrfToken
        || claims.expiresAt <= now || claims.issuedAt > now || claims.expiresAt - claims.issuedAt !== 300) throw invalid();
      return claims.nonce;
    } catch { throw invalid(); }
  }
  private sign(payload: string) { return createHmac('sha256', this.key).update(`cinehook:google-challenge:payload:v1:${payload}`).digest('base64url'); }
}
