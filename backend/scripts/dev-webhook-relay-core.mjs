import {createServer,request} from 'node:http';
const path='/api/webhooks/razorpay',maximum=100*1024;
export function createWebhookRelay({upstreamPort=4000}={}){
  if(!Number.isInteger(upstreamPort)||upstreamPort<1||upstreamPort>65535)throw new Error('Invalid local upstream port.');
  let active=0;
  const server=createServer(async(req,res)=>{
    const reply=(status)=>{if(!res.headersSent&&!res.destroyed)res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({received:status===200}));};
    if(req.method!=='POST'||req.url!==path){req.resume();reply(404);return;}
    const signature=req.headers['x-razorpay-signature'],eventId=req.headers['x-razorpay-event-id'];
    if(typeof signature!=='string'||! /^[a-fA-F0-9]{64}$/.test(signature)||typeof eventId!=='string'||! /^[A-Za-z0-9_.:-]{1,100}$/.test(eventId)
      ||! /^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']??'')||req.headers['content-encoding']){req.resume();reply(400);return;}
    if(Number(req.headers['content-length']??0)>maximum){req.resume();reply(413);return;}
    if(active>=8){req.resume();reply(503);return;}
    active++;
    try{
      let length=0;const chunks=[];
      for await(const chunk of req){length+=chunk.length;if(length>maximum){reply(413);return;}chunks.push(chunk);}
      const body=Buffer.concat(chunks);
      await new Promise(resolve=>{
        const upstream=request({hostname:'127.0.0.1',port:upstreamPort,path,method:'POST',headers:{'content-type':'application/json','content-length':body.length,'x-razorpay-signature':signature,'x-razorpay-event-id':eventId}},response=>{
          // No provider payload, credentials or internal response is logged/exposed.
          response.resume();response.on('end',()=>{reply(response.statusCode??502);resolve();});response.on('error',()=>{reply(502);resolve();});
        });
        const timer=setTimeout(()=>upstream.destroy(),10000);timer.unref();
        upstream.on('close',()=>clearTimeout(timer));upstream.on('error',()=>{reply(502);resolve();});
        res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});upstream.end(body);
      });
    }catch{reply(400);}finally{active--;}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=3000;
  return server;
}
