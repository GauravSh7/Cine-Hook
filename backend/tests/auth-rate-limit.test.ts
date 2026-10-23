import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AuthRateLimiter } from '../src/modules/auth/auth-rate-limit.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import {createApp} from '../src/app.js';
import {testCatalog} from './helpers/catalog.js';

describe('auth entry-point limits', () => {
  const secret = 'isolated-rate-limit-secret-not-a-credential';
  it('fails closed on unavailable or failing Redis without leaking details', async () => {
    for (const redis of [{ isReady: false, eval: vi.fn() }, { isReady: true, eval: vi.fn().mockRejectedValue(new Error('secret redis://password')) }]) {
      const app = express(); app.use(express.json(), new AuthRateLimiter(redis, secret).middleware(), errorHandler);
      const r = await request(app).post('/login').send({ email: 'owner@example.test' });
      expect(r.status).toBe(503); expect(JSON.stringify(r.body)).not.toContain('password');
      expect(r.headers['retry-after']).toBe('30');
    }
  });
  it('returns generic 429 plus Retry-After and never forwards identity or password to Redis', async () => {
    const evalRedis = vi.fn().mockResolvedValue([0, 45001]);
    const app = express(); app.use(express.json(), new AuthRateLimiter({ isReady: true, eval: evalRedis }, secret).middleware(), errorHandler);
    const r = await request(app).post('/login').set('X-Forwarded-For','1.2.3.4').send({ email: ' Owner@Example.Test ', password: 'private-password' });
    expect(r.status).toBe(429); expect(r.headers['retry-after']).toBe('46');
    expect(r.body.error.code).toBe('AUTH_RATE_LIMITED');
    expect(JSON.stringify(evalRedis.mock.calls)).not.toMatch(/Owner|Example|private-password|1\.2\.3\.4/);
  });
  it('leaves ownership OTP, recovery, GET config and authenticated reads to existing controls', async () => {
    const evalRedis = vi.fn(); const app = express();
    app.use(express.json(), new AuthRateLimiter({ isReady: false, eval: evalRedis }, secret).middleware());
    app.use((_req,res)=>res.sendStatus(204));
    for (const path of ['/ownership/request','/ownership/verify','/forgot-password','/verify-reset-otp']) expect((await request(app).post(path).send({})).status).toBe(204);
    expect((await request(app).get('/me')).status).toBe(204); expect(evalRedis).not.toHaveBeenCalled();
  });
  it('canonicalizes email independently of forwarded headers; isolates action buckets', async () => {
    const evalRedis = vi.fn().mockResolvedValue([1,0]); const limiter = new AuthRateLimiter({isReady:true,eval:evalRedis},secret);
    const app=express();app.use(express.json(),limiter.middleware());app.use((_req,res)=>res.sendStatus(204));
    await request(app).post('/login').send({email:' Owner@Example.Test '});
    await request(app).post('/login').set('X-Forwarded-For','9.8.7.6').send({email:'owner@example.test'});
    await request(app).post('/register').send({email:'owner@example.test'});
    expect(evalRedis.mock.calls[0][1].keys).toEqual(evalRedis.mock.calls[1][1].keys);
    expect(evalRedis.mock.calls[0][1].keys[1]).not.toBe(evalRedis.mock.calls[2][1].keys[1]);
  });
  it('enforces the limiter on actual application auth routes before controller work',async()=>{
    const login=vi.fn(),register=vi.fn();
    const app=createApp({frontendOrigin:'http://localhost:5173',healthService:{} as any,catalog:testCatalog().services,
      auth:{service:{login,register} as any,tokens:{} as any},authRateLimiter:new AuthRateLimiter({isReady:true,eval:async()=>[0,900000]},secret)});
    for(const path of ['/api/auth/login','/api/auth/register']){
      const r=await request(app).post(path).send({email:'known-or-unknown@example.test',password:'not-used'});
      expect(r.status).toBe(429);expect(r.headers['retry-after']).toBe('900');
    }
    expect(login).not.toHaveBeenCalled();expect(register).not.toHaveBeenCalled();
    expect((await request(app).get('/api/health/live')).status).toBe(200);
  });
  it('validates the global abuse budget instead of allowing an accidental limiter disable',()=>{
    for(const limit of [0,99,10001,NaN,1.5])expect(()=>new AuthRateLimiter({isReady:true,eval:vi.fn()},secret,limit)).toThrow();
  });
  it('bounds a stalled Redis operation and never falls back to admitting auth',async()=>{
    vi.useFakeTimers();
    try{
      const next=vi.fn(),setHeader=vi.fn();
      const run=new AuthRateLimiter({isReady:true,eval:()=>new Promise(()=>{})},secret).middleware()(
        {method:'POST',path:'/login',body:{email:'owner@example.test'}} as any,{setHeader} as any,next);
      await vi.advanceTimersByTimeAsync(2001);await run;
      expect(next).toHaveBeenCalledWith(expect.objectContaining({status:503,code:'AUTH_TEMPORARILY_UNAVAILABLE'}));
      expect(setHeader).toHaveBeenCalledWith('Retry-After','30');
    }finally{vi.useRealTimers();}
  });
});
