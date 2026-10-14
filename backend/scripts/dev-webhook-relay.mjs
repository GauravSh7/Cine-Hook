import {createWebhookRelay} from './dev-webhook-relay-core.mjs';
// No .env loading, arbitrary upstream target, database connection or credentials.
if(process.env.NODE_ENV==='production')throw new Error('Development webhook relay cannot run in production.');
const server=createWebhookRelay();
server.listen(4011,'127.0.0.1',()=>console.log('Webhook-only relay: 127.0.0.1:4011; POST /api/webhooks/razorpay only.'));
server.on('error',()=>{console.error('Webhook relay could not start. Check the local port.');process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
