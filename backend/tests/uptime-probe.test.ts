import {it,expect} from 'vitest';
import {probeUptime} from '../scripts/uptime-probe.mjs';
it('accepts healthy JSON dependencies and a working frontend',async()=>{
 const results=await probeUptime(async(url:string)=>new Response(url.endsWith('/ready')?JSON.stringify({success:true,data:{database:'up',redis:'up',status:'ready'}}):url.endsWith('/live')?JSON.stringify({success:true,data:{status:'alive'}}):'<html>CineHook</html>',{status:200}));
 expect(results.every((r:{ok:boolean})=>r.ok)).toBe(true);
});
it('reports readiness and proxy failures without including response bodies',async()=>{
 const results=await probeUptime(async()=>new Response('private-secret-provider-body',{status:503}),1);
 expect(results.every((r:{ok:boolean})=>!r.ok)).toBe(true);expect(JSON.stringify(results)).not.toContain('private-secret');
});
