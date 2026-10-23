import {pathToFileURL} from 'node:url';

// Public read-only URLs only. No credentials, account checks, order creation or
// payment/webhook payloads. Hourly cadence allows Render Free to sleep.
const checks=[
 {name:'backend-live',url:'https://cinehook.onrender.com/api/health/live',kind:'live'},
 {name:'backend-ready',url:'https://cinehook.onrender.com/api/health/ready',kind:'ready'},
 {name:'frontend-api-ready',url:'https://cine-hook-xi.vercel.app/api/health/ready',kind:'ready'},
 {name:'frontend',url:'https://cine-hook-xi.vercel.app/',kind:'html'},
];
export async function probeUptime(fetcher=fetch,attempts=2){
 return Promise.all(checks.map(async check=>{
  for(let attempt=1;attempt<=attempts;attempt++){
   try{
    const r=await fetcher(check.url,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(75000)});
    let ok=r.status===200;
    if(check.kind==='ready'){
     const b=await r.json();ok=ok&&b.success===true&&b.data?.status==='ready'&&b.data.database==='up'&&b.data.redis==='up';
    }else if(check.kind==='live'){
     const b=await r.json();ok=ok&&b.success===true;
    }else{ok=ok&&(await r.text()).includes('CineHook');}
    if(ok||attempt===attempts)return {name:check.name,ok,status:r.status,attempt};
   }catch{if(attempt===attempts)return {name:check.name,ok:false,status:0,attempt};}
  }
 }));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const results=await probeUptime();for(const result of results)console.log(JSON.stringify({event:'uptime_probe',...result}));
 if(results.some(r=>!r.ok)){console.error('::error::CineHook uptime/readiness check failed; inspect provider status and safe structured logs.');process.exitCode=1;}
}
