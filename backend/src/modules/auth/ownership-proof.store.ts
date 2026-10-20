import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../errors/app-error.js';

export const proofPurpose = z.enum(['REGISTER', 'VERIFY_LEGACY', 'CLEAN_START', 'RESET_PASSWORD']);
export type ProofPurpose = z.infer<typeof proofPurpose>;
const evidenceSchema = z.object({ purpose: proofPurpose, email: z.string().email(),
  snapshot: z.object({ userId: z.string().uuid(), authVersion: z.number().int().nonnegative(), credentialTag: z.string().regex(/^[a-f0-9]{64}$/) }).strict().nullable(),
}).strict();
export type OwnershipEvidence = z.infer<typeof evidenceSchema>;
interface ProofRedis {
  isReady: boolean;
  getDel(key: string): Promise<string | null>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}
export class OwnershipProofStore {
  constructor(private readonly redis: ProofRedis, private readonly secret: string) {}
  private ready() { if (!this.redis.isReady) throw new AppError(503, 'AUTH_TEMPORARILY_UNAVAILABLE', 'Authentication is temporarily unavailable.'); }
  private digest(value: string) { return createHmac('sha256', this.secret).update(`ownership:v1:${value}`).digest('hex'); }
  async request(input: OwnershipEvidence & { address: string; send: (otp: string) => Promise<void> }) {
    this.ready();
    const email = input.email.trim().toLowerCase();
    const evidence = evidenceSchema.parse({ purpose: input.purpose, email, snapshot: input.snapshot });
    const challengeId = randomBytes(32).toString('base64url'), otp = String(randomInt(1000000)).padStart(6, '0');
    const key = `auth:ownership:otp:${this.digest(challengeId)}`;
    const permitted = await this.redis.eval(`
local email=redis.call('INCR',KEYS[1]); if email==1 then redis.call('EXPIRE',KEYS[1],3600) end
local network=redis.call('INCR',KEYS[2]); if network==1 then redis.call('EXPIRE',KEYS[2],3600) end
if email>5 or network>100 then return 0 end
local previous=redis.call('GET',KEYS[3]); if previous then redis.call('DEL',previous) end
redis.call('SET',KEYS[4],ARGV[1],'EX',600)
redis.call('SET',KEYS[3],KEYS[4],'EX',600)
return 1`, { keys: [`auth:ownership:limit:email:${this.digest(email)}`, `auth:ownership:limit:network:${this.digest(input.address)}`,
      `auth:ownership:latest:${this.digest(email)}:${evidence.purpose}`, key],
    arguments: [JSON.stringify({ evidence, digest: this.digest(`${challengeId}:${otp}`), attempts: 0 })] });
    if (Number(permitted) !== 1) throw new AppError(429, 'OWNERSHIP_RATE_LIMITED', 'Too many code requests. Please try again later.');
    // Never return delivery details that reveal account existence. Failed delivery
    // invalidates the specific challenge, without deleting a newer resend.
    void input.send(otp).catch(async () => {
      try { await this.redis.getDel(key); } catch { /* Short TTL still bounds failure. */ }
      console.warn(JSON.stringify({ event: 'ownership_email_delivery_failed' }));
    });
    return { challengeId, message: 'Check your email for a verification code.' };
  }
  async verify(challengeId: string, otp: string) {
    this.ready();
    if (!/^[A-Za-z0-9_-]{43}$/.test(challengeId) || !/^\d{6}$/.test(otp)) throw invalid();
    const token = randomBytes(32).toString('base64url');
    const success = await this.redis.eval(`
local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
local ttl=redis.call('PTTL',KEYS[1]); if ttl<=0 then return 0 end
local value=cjson.decode(raw); value.attempts=value.attempts+1
if value.attempts>5 then redis.call('DEL',KEYS[1]); return 0 end
if value.digest~=ARGV[1] then
  if value.attempts>=5 then redis.call('DEL',KEYS[1]) else redis.call('SET',KEYS[1],cjson.encode(value),'PX',ttl) end
  return 0
end
redis.call('DEL',KEYS[1]); redis.call('SET',KEYS[2],cjson.encode(value.evidence),'PX',math.min(ttl,300000)); return 1`, {
      keys: [`auth:ownership:otp:${this.digest(challengeId)}`, `auth:ownership:grant:${this.digest(token)}`], arguments: [this.digest(`${challengeId}:${otp}`)] });
    if (Number(success) !== 1) throw invalid();
    return { token, message: 'Email verified. Complete your selected action.' };
  }
  async consume(token: string, purpose: ProofPurpose): Promise<OwnershipEvidence | null> {
    this.ready(); if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const raw = await this.redis.getDel(`auth:ownership:grant:${this.digest(token)}`);
    if (!raw) return null;
    try { const parsed = evidenceSchema.safeParse(JSON.parse(raw)); return parsed.success && parsed.data.purpose === purpose ? parsed.data : null; }
    catch { return null; }
  }
}
function invalid() { return new AppError(400, 'OWNERSHIP_PROOF_INVALID', 'The verification code or session is invalid or expired. Start again.'); }
