import {expect, it} from 'vitest';
import {createServer} from 'node:http';
import {createWebhookRelay} from '../scripts/dev-webhook-relay-core.mjs';

async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;}
async function close(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
const headers={'content-type':'application/json','x-razorpay-signature':'a'.repeat(64),'x-razorpay-event-id':'evt_test_1'};
it('relay forwards only exact webhook POST and preserves bytes and evidence headers',async()=>{
  let received;
  const upstream=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);received={url:req.url,method:req.method,headers:req.headers,body:Buffer.concat(chunks)};res.writeHead(200,{'content-type':'application/json'}).end('{"received":true}');});
  const target=await listen(upstream),relay=createWebhookRelay({upstreamPort:Number(new URL(target).port)}),url=await listen(relay);
  try{
    const raw=Buffer.from('{ "event" : "payment.captured", "payload": {} }\n');
    const result=await fetch(`${url}/api/webhooks/razorpay`,{method:'POST',headers:{...headers,authorization:'Bearer must-not-forward',cookie:'must-not-forward=1'},body:raw});
    expect(result.status).toBe(200);expect(received.body).toEqual(raw);expect(received.url).toBe('/api/webhooks/razorpay');expect(received.method).toBe('POST');
    expect(received.headers['x-razorpay-signature']).toBe(headers['x-razorpay-signature']);expect(received.headers['x-razorpay-event-id']).toBe(headers['x-razorpay-event-id']);
    expect(received.headers.authorization).toBeUndefined();expect(received.headers.cookie).toBeUndefined();
    received=undefined;
    for(const [path,method] of [['/api/admin','POST'],['/api/movies','GET'],['/api/webhooks/razorpay','GET'],['/api/webhooks/razorpay','OPTIONS'],['/api/webhooks/razorpay?target=admin','POST'],['/api/webhooks/%72azorpay','POST']]){
      expect((await fetch(url+path,{method,headers,body:method==='POST'?'{}':undefined})).status).toBe(404);
    }
    expect(received).toBeUndefined();
  }finally{await close(relay);await close(upstream);}
});
it('relay rejects missing evidence headers, compression and oversized payloads',async()=>{
  const relay=createWebhookRelay({upstreamPort:1}),url=await listen(relay);
  try{
    expect((await fetch(url+'/api/webhooks/razorpay',{method:'POST',body:'{}'})).status).toBe(400);
    expect((await fetch(url+'/api/webhooks/razorpay',{method:'POST',headers:{...headers,'content-encoding':'gzip'},body:'{}'})).status).toBe(400);
    expect((await fetch(url+'/api/webhooks/razorpay',{method:'POST',headers,body:'x'.repeat(102401)})).status).toBe(413);
    expect((await fetch(url+'/api/webhooks/razorpay',{method:'POST',headers,body:'{}'})).status).toBe(502);
  }finally{await close(relay);}
});
