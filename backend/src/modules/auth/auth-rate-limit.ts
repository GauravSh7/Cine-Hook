import { createHmac } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from '../../errors/app-error.js';

interface RateRedis {
  isReady: boolean;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}
// One atomic decision across the deployment budget and account bucket. Rejected
// account attempts don't spend the deployment budget or extend the lockout.
const acquire = `
local function read(key)
 local ttl=redis.call('PTTL',key)
 if ttl<=0 then return 0,0 end
 return tonumber(redis.call('GET',key) or '0'),ttl
end
local global,gt=read(KEYS[1]); local account,at=read(KEYS[2])
local retry=0
if global>=tonumber(ARGV[1]) then retry=gt end
if account>=tonumber(ARGV[3]) then retry=math.max(retry,at) end
if retry>0 then return {0,retry} end
if gt==0 then redis.call('SET',KEYS[1],1,'PX',ARGV[2]) else redis.call('INCR',KEYS[1]) end
if at==0 then redis.call('SET',KEYS[2],1,'PX',ARGV[4]) else redis.call('INCR',KEYS[2]) end
return {1,0}`;

export class AuthRateLimiter {
  constructor(private readonly redis: RateRedis, private readonly secret: string, private readonly globalLimit = 2000) {
    if (!Number.isInteger(globalLimit) || globalLimit < 100 || globalLimit > 10000) throw new Error('Invalid auth API budget');
  }
  middleware(): RequestHandler {
    return async (req, res, next) => {
      if (req.method !== 'POST') { next(); return; }
      const path = req.path.toLowerCase().replace(/\/$/, '');
      let identity: string, limit: number, windowMs: number;
      if (path === '/login' || path === '/register') {
        const email: unknown = req.body?.email;
        identity = typeof email === 'string' && email.length <= 300 ? email.trim().toLowerCase() : 'invalid';
        if (!identity || identity.length > 254 || !identity.includes('@')) identity = 'invalid';
        limit = path === '/login' ? 10 : 5; windowMs = path === '/login' ? 900000 : 3600000;
      } else if (path === '/google/challenge') {
        // No trustworthy client identity before Google verification. This is an
        // explicit deployment-wide budget, never a shared proxy-IP quota.
        identity = 'challenge-budget'; limit = this.globalLimit; windowMs = 900000;
      } else if (['/google', '/google/link', '/ownership/complete', '/reset-password'].includes(path)) {
        const credential: unknown = req.body?.credential ?? req.body?.token;
        identity = typeof credential === 'string' && credential.length <= 16384 ? credential : 'invalid';
        limit = 5; windowMs = 60000;
      } else { next(); return; }
      let timer:ReturnType<typeof setTimeout>|undefined;
      try {
        if (!this.redis.isReady) throw new Error('Redis unavailable');
        const digest = (value: string) => createHmac('sha256', this.secret).update(`auth-rate:v1:${value}`).digest('hex');
        const result = await Promise.race([this.redis.eval(acquire, {
          keys: [`cinehook:{auth-rate}:global:${digest('budget')}`, `cinehook:{auth-rate}:account:${digest(path + ':' + identity)}`],
          arguments: [String(this.globalLimit), '900000', String(limit), String(windowMs)],
        }),new Promise<never>((_resolve,reject)=>{
          timer=setTimeout(()=>reject(new Error('Limiter timed out')),2000);timer.unref();
        })]);
        if (!Array.isArray(result) || result.length !== 2 || ![0,1].includes(Number(result[0])) || !Number.isFinite(Number(result[1]))) throw new Error('Invalid limiter response');
        if (Number(result[0]) === 0) {
          res.setHeader('Retry-After', String(Math.max(1, Math.ceil(Number(result[1]) / 1000))));
          res.setHeader('Cache-Control', 'no-store');
          next(new AppError(429, 'AUTH_RATE_LIMITED', 'Too many authentication attempts. Please try again later.')); return;
        }
        next();
      } catch {
        res.setHeader('Retry-After', '30');
        next(new AppError(503, 'AUTH_TEMPORARILY_UNAVAILABLE', 'Authentication is temporarily unavailable. Please try again.'));
      } finally { if(timer)clearTimeout(timer); }
    };
  }
}
