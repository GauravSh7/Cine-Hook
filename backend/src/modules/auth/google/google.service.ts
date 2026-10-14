import { z } from 'zod';
import bcrypt from 'bcrypt';
import { AppError } from '../../../errors/app-error.js';
import { toPublicUser } from '../auth.types.js';
import type { TokenService } from '../token.service.js';
import type { GoogleUserStore, GoogleVerifier } from './google.types.js';

const claimsSchema = z.object({
  sub: z.string().min(1).max(255).regex(/^[A-Za-z0-9_-]+$/), email: z.string().trim().max(254).email().transform(v => v.toLowerCase()),
  email_verified: z.literal(true), aud: z.string().max(256), iss: z.enum(['accounts.google.com', 'https://accounts.google.com']),
  exp: z.number().int().positive(), iat: z.number().int().nonnegative(), nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  name: z.string().trim().min(1).max(100).optional(), hd: z.string().trim().min(1).max(253).optional(),
});
const invalid = () => new AppError(401, 'GOOGLE_INVALID_CREDENTIAL', 'Google sign-in could not be verified. Please try again.');

export class GoogleAuthService {
  constructor(private readonly users: GoogleUserStore, private readonly verifier: GoogleVerifier,
    private readonly tokens: TokenService, readonly clientId?: string) {}
  requireConfigured() { if (!this.clientId) throw new AppError(503, 'GOOGLE_UNAVAILABLE', 'Google sign-in is not configured. Please use email and password.'); }
  private async verifiedClaims(credential: string, nonce: string) {
    this.requireConfigured();
    let raw: unknown;
    try { raw = await this.verifier.verify(credential); } catch { throw invalid(); }
    const parsed = claimsSchema.safeParse(raw), now = Math.floor(Date.now() / 1000);
    if (!parsed.success || parsed.data.aud !== this.clientId || parsed.data.nonce !== nonce || parsed.data.exp <= now
      || parsed.data.iat > now + 60 || parsed.data.exp <= parsed.data.iat || parsed.data.exp - parsed.data.iat > 86400) throw invalid();
    return parsed.data;
  }
  async link(userId:string,password:string,credential:string,nonce:string) {
    const claims=await this.verifiedClaims(credential,nonce).catch(error=>{
      if(error instanceof AppError && error.status===401)throw new AppError(403,'GOOGLE_LINK_PROOF_REQUIRED','Confirm your password and retry Google verification.');
      throw error;
    });
    const stored=await this.users.findByEmail(claims.email);
    if(!stored || stored.id!==userId || !stored.passwordHash || !await bcrypt.compare(password,stored.passwordHash)) {
      throw new AppError(403,'GOOGLE_LINK_PROOF_REQUIRED','Confirm your existing password and select the Google account with the same email.');
    }
    const owner=await this.users.findBySubject(claims.sub);
    if(owner && owner.id!==userId)throw new AppError(409,'GOOGLE_LINK_CONFLICT','This Google identity cannot be linked to this account.');
    if(!this.users.linkGoogle)throw new AppError(503,'GOOGLE_LINK_UNAVAILABLE','Google linking is unavailable.');
    const user=await this.users.linkGoogle({userId,googleSubject:claims.sub,email:claims.email,passwordHash:stored.passwordHash});
    return {user:toPublicUser(user),accessToken:this.tokens.sign({userId:user.id,role:user.role}),tokenType:'Bearer'};
  }
  async login(credential: string, nonce: string) {
    const claims = await this.verifiedClaims(credential,nonce);
    let user = await this.users.findBySubject(claims.sub);
    if (!user) {
      const existing = await this.users.findByEmail(claims.email);
      if (existing) {
        // A request for this same verified subject may have committed between
        // the two reads. Email alone never identifies or links an account.
        user = await this.users.findBySubject(claims.sub);
        if (!user && existing.googleSubject === null && this.authoritativeEmail(claims.email, claims.hd) && this.users.linkVerifiedGoogle) {
          try { user = await this.users.linkVerifiedGoogle({ userId: existing.id, googleSubject: claims.sub, email: claims.email }); }
          catch (error) {
            if (!(error instanceof AppError) || error.code !== 'GOOGLE_IDENTITY_CONFLICT') throw error;
            user = await this.users.findBySubject(claims.sub);
            if (!user || user.id !== existing.id) throw this.emailConflict();
          }
        }
        if (!user) throw this.emailConflict();
      }
    }
    if (!user) {
      try { user = await this.users.createGoogle({ googleSubject: claims.sub, email: claims.email, name: claims.name ?? 'Google user' }); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== 'GOOGLE_IDENTITY_CONFLICT') throw error;
        user = await this.users.findBySubject(claims.sub);
        if (!user) throw this.emailConflict();
      }
    }
    return { user: toPublicUser(user), accessToken: this.tokens.sign({ userId: user.id, role: user.role }), tokenType: 'Bearer' };
  }
  private authoritativeEmail(email: string, hostedDomain?: string) {
    const domain = email.split('@')[1]?.toLowerCase();
    return domain === 'gmail.com' || Boolean(hostedDomain && hostedDomain.toLowerCase() === domain);
  }
  private emailConflict() { return new AppError(409, 'GOOGLE_EMAIL_CONFLICT', 'This email already has an account. Sign in with your existing password.'); }
}
