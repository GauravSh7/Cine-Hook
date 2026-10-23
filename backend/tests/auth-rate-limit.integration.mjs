import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createClient} from 'redis';
import express from 'express';
import request from 'supertest';
import {AuthRateLimiter} from '../src/modules/auth/auth-rate-limit.ts';
import {errorHandler} from '../src/middleware/error-handler.ts';

const url=process.env.AUTH_RATE_TEST_REDIS_URL;
test('atomic Redis auth limits through real HTTP middleware',{skip:!url,timeout:30000},async t=>{
  const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/15');
  assert.ok(['55449','6379'].includes(target.port),'Use isolated test Redis only');
  const redis=createClient({url,disableOfflineQueue:true,socket:{reconnectStrategy:false}});await redis.connect();
  const secret=randomUUID(); const app=express();let accepted=0;
  app.use(express.json(),new AuthRateLimiter(redis,secret,200).middleware());
  app.use((_req,res)=>{accepted++;res.sendStatus(204);});app.use(errorHandler);
  const post=(path,email)=>request(app).post(path).set('X-Forwarded-For',randomUUID()).set('X-Real-IP',randomUUID()).send({email});
  try {
    await t.test('two workers admit exactly ten simultaneous password attempts',async()=>{
      const email=randomUUID()+'@example.test';const results=await Promise.all(Array.from({length:30},()=>post('/login',email)));
      assert.equal(results.filter(r=>r.status===204).length,10);assert.equal(results.filter(r=>r.status===429).length,20);
      const worker=express();worker.use(express.json(),new AuthRateLimiter(redis,secret,200).middleware());worker.use((_req,res)=>res.sendStatus(204));worker.use(errorHandler);
      assert.equal((await request(worker).post('/login').send({email})).status,429);
      assert.ok(Number(results.find(r=>r.status===429).headers['retry-after'])>0);
    });
    await t.test('canonical identity defeats case/header rotation and blocked attempts do not extend TTL',async()=>{
      const email=randomUUID()+'@example.test';for(let i=0;i<10;i++)assert.equal((await post('/login',email)).status,204);
      assert.equal((await post('/LOGIN/',email.toUpperCase())).status,429);
      // A fresh isolated secret means expiry touches only this run's exact key.
      const expiry=express(),expirySecret=randomUUID();const seen=[];
      const recording={isReady:true,eval:async(s,o)=>{seen.push(...o.keys);return redis.eval(s,o);}};
      expiry.use(express.json(),new AuthRateLimiter(recording,expirySecret).middleware());expiry.use((_req,res)=>res.sendStatus(204));expiry.use(errorHandler);
      for(let i=0;i<10;i++)await request(expiry).post('/login').send({email});
      const key=seen[1];assert.ok(!key.includes('@'));await redis.pExpire(key,500);
      assert.equal((await request(expiry).post('/login').send({email})).status,429);
      assert.ok(await redis.pTTL(key)<=500);await new Promise(r=>setTimeout(r,600));
      assert.equal((await request(expiry).post('/login').send({email})).status,204);
    });
    await t.test('distinct legitimate mailboxes behind one proxy are not one quota',async()=>{
      for(let i=0;i<105;i++)assert.equal((await post('/login',randomUUID()+'@example.test')).status,204);
    });
    await t.test('registration is limited independently and account existence is never queried',async()=>{
      const email=randomUUID()+'@example.test';for(let i=0;i<5;i++)assert.equal((await post('/register',email)).status,204);
      const prior=accepted;assert.equal((await post('/register',email)).status,429);assert.equal(accepted,prior);
      assert.equal((await post('/login',email)).status,204);
    });
    await t.test('global credential-spray budget is atomic and independent of headers',async()=>{
      const spray=express();spray.use(express.json(),new AuthRateLimiter(redis,randomUUID(),100).middleware());spray.use((_req,res)=>res.sendStatus(204));spray.use(errorHandler);
      const results=await Promise.all(Array.from({length:120},(_,i)=>request(spray).post('/google').set('X-Forwarded-For',String(i)).send({credential:randomUUID()})));
      assert.equal(results.filter(r=>r.status===204).length,100);assert.equal(results.filter(r=>r.status===429).length,20);
    });
    await t.test('Redis failure blocks protected auth but not existing health/OTP control paths',async()=>{
      await redis.quit();assert.equal((await post('/login','any@example.test')).status,503);assert.equal((await post('/ownership/verify','any@example.test')).status,204);
    });
  }finally{if(redis.isOpen)await redis.quit();}
});
