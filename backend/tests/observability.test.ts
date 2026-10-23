import { it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestId } from '../src/middleware/request-id.js';
import { requestTelemetry } from '../src/middleware/request-telemetry.js';
import { createShutdown } from '../src/lib/lifecycle.js';

it('logs failed requests with generated IDs and route templates, never secrets or raw URLs', async () => {
  const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
  try {
    const app=express(); app.use(requestId,requestTelemetry);
    app.get('/private/:token',(_req,res)=>res.sendStatus(503));
    const r=await request(app).get('/private/secret-token?password=secret-password').set('X-Request-Id','spoofed');
    const event=JSON.parse(log.mock.calls[0][0]);
    expect(event).toMatchObject({event:'request_completed',status:503,route:'/private/:token',method:'GET'});
    expect(event.requestId).toBe(r.headers['x-request-id']); expect(event.requestId).not.toBe('spoofed');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret-token|secret-password|spoofed/);
  }finally{log.mockRestore();}
});
it('shuts down once, reports rejected cleanup safely and uses a nonzero exit', async () => {
  const logs=vi.spyOn(console,'info').mockImplementation(()=>{}), errors=vi.spyOn(console,'error').mockImplementation(()=>{});
  const exit=vi.fn(),close=vi.fn((cb:()=>void)=>cb());
  try {
    const stop=createShutdown({close},async()=>{throw new Error('password=hidden');},{exit,timeoutMs:1000});
    stop('SIGTERM');stop('SIGINT'); await new Promise(resolve=>setTimeout(resolve,0));
    expect(close).toHaveBeenCalledTimes(1);expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.stringify(errors.mock.calls)).not.toContain('hidden');
    expect(logs.mock.calls.map(c=>JSON.parse(c[0]).event)).toEqual(['shutdown_started','shutdown_completed']);
  }finally{logs.mockRestore();errors.mockRestore();}
});
it('forces a nonzero exit on shutdown deadline without logging raw exceptions', async () => {
  vi.useFakeTimers();const error=vi.spyOn(console,'error').mockImplementation(()=>{}),info=vi.spyOn(console,'info').mockImplementation(()=>{}),exit=vi.fn();
  try{createShutdown({close:()=>{}},async()=>{}, {exit,timeoutMs:100})('SIGTERM');await vi.advanceTimersByTimeAsync(100);expect(exit).toHaveBeenCalledWith(1);expect(JSON.parse(error.mock.calls[0][0]).event).toBe('shutdown_timeout');}
  finally{vi.useRealTimers();error.mockRestore();info.mockRestore();}
});
