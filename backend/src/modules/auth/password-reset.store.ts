import { z } from 'zod';
import { AppError } from '../../errors/app-error.js';
import type { PasswordRecoveryStore, RecoveryToken, SessionGuard } from './password-reset.types.js';

interface RecoveryRedis {
  isReady: boolean;
  get(key: string): Promise<string | null>;
  getDel(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}
const recovery = z.object({ userId: z.string().uuid(), credentialTag: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const limits = `local email = redis.call('INCR', KEYS[1])
if email == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
local ip = redis.call('INCR', KEYS[2])
if ip == 1 then redis.call('EXPIRE', KEYS[2], 3600) end
if email > 5 or ip > 1000 then return 0 end
return 1`;

export class PasswordResetStore implements PasswordRecoveryStore, SessionGuard {
  constructor(private readonly redis: RecoveryRedis,
    private readonly currentCredentialTag?: (userId: string) => Promise<string | null>) {}
  private ready() {
    if (!this.redis.isReady) throw new AppError(503, 'AUTH_TEMPORARILY_UNAVAILABLE', 'Sign-in is temporarily unavailable. Please try again.');
  }
  async allowRequest(emailKey: string, ipKey: string) {
    this.ready();
    return Number(await this.redis.eval(limits, { keys: [`auth:recovery:email:${emailKey}`, `auth:recovery:ip:${ipKey}`], arguments: [] })) === 1;
  }
  async save(tokenHash: string, value: RecoveryToken, seconds: number) {
    this.ready(); await this.redis.set(`auth:recovery:token:${tokenHash}`, JSON.stringify(value), { EX: seconds });
  }
  async consume(tokenHash: string) {
    this.ready();
    const value = await this.redis.getDel(`auth:recovery:token:${tokenHash}`);
    if (!value) return null;
    const parsed = recovery.safeParse(JSON.parse(value) as unknown);
    return parsed.success ? parsed.data : null;
  }
  async valid(userId: string, authenticatedAtMs: number, passwordTag?: string) {
    this.ready();
    const cutoff = await this.redis.get(`auth:revoked-before:${userId}`);
    if (cutoff !== null) {
      const revoked = JSON.parse(cutoff) as { time: number };
      if (!Number.isFinite(revoked.time) || authenticatedAtMs <= revoked.time) return false;
    }
    // Check the actual PostgreSQL credential after a concurrent reset. A login
    // started with an old password must not mint a usable token after recovery.
    if (passwordTag && this.currentCredentialTag) return passwordTag === await this.currentCredentialTag(userId);
    return true;
  }
  async revoke(userId: string) {
    this.ready();
    // All signed access tokens expire within 24h; no user auth state is process-local.
    await this.redis.set(`auth:revoked-before:${userId}`, JSON.stringify({ time: Date.now() }), { EX: 86401 });
  }
}
