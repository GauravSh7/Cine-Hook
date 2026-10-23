import type { RequestHandler } from 'express';

export const requestTelemetry: RequestHandler = (req,res,next) => {
  const start=performance.now();
  res.once('finish',()=>{
    const durationMs=Math.round(performance.now()-start);
    // No URLs, query strings, params, headers, identities or response bodies.
    if(res.statusCode>=500 || res.statusCode===429 || durationMs>=2000) {
      console.warn(JSON.stringify({event:'request_completed',requestId:res.locals.requestId,
        method:req.method,route:typeof req.route?.path==='string'?req.route.path:'unmatched',
        status:res.statusCode,durationMs}));
    }
  });
  next();
};
