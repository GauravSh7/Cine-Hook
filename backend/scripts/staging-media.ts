import type {CatalogueGroup} from './staging-manifest.js';

const frontend='https://cine-hook-xi.vercel.app';
export type MediaAudit={assets:Array<{url:string;provider:string;available:boolean;status:number|null;finding?:string;attempts?:number}>;failed:number;rightsReviewRequired:string[]};
export type MediaPermission={url:string;licenceSource:string;rightsBasis:string};
function approvedUrl(raw:string):{url:string;provider:string}|null{
  if(/^\/(?:demo-art|provider-assets)\/[a-zA-Z0-9_-]+\.(?:svg|png|jpg|webp)$/.test(raw))return {url:frontend+raw,provider:'bundled'};
  try{const u=new URL(raw);
    if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port||!['image.tmdb.org','images.unsplash.com','upload.wikimedia.org'].includes(u.hostname))return null;
    return {url:raw,provider:u.hostname};
  }catch{return null;}
}
export async function auditCatalogueMedia(groups:CatalogueGroup[],fetcher:typeof fetch=fetch):Promise<MediaAudit>{
  const urls=new Set<string>();let tmdb=false;
  for(const group of groups)for(const row of group.rows){
    for(const field of group.model==='movie'?['posterUrl','backdropUrl']:['imageUrl'])if(typeof row[field]==='string'&&row[field])urls.add(row[field] as string);
    if(group.model==='movie'&&(row.artworkKind==='TMDB'||row.ratingSource==='TMDB'))tmdb=true;
  }
  if(tmdb)urls.add('/provider-assets/tmdb-logo.svg');
  const entries=[...urls].sort(),assets:MediaAudit['assets']=[],rightsReviewRequired:string[]=[];let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(cursor<entries.length){const raw=entries[cursor++]!,target=approvedUrl(raw);
      if(!target){assets.push({url:'[rejected-media-url]',provider:'unapproved',available:false,status:null,finding:'UNAPPROVED',attempts:0});continue;}
      if(target.provider==='upload.wikimedia.org')rightsReviewRequired.push(raw);
      let status:number|null=null,available=false,finding='NETWORK_UNVERIFIED',attempts=0;
      for(const method of ['HEAD','GET','GET']){
        if(attempts===2&&finding!=='NETWORK_UNVERIFIED')break;
        attempts++;
        try{
          const response=await fetcher(target.url,{method,headers:method==='GET'?{Range:'bytes=0-1023'}:undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
          status=response.status;available=response.ok&&/^image\//i.test(response.headers.get('content-type')??'');
          if(method==='GET')await response.body?.cancel();
          if(available){finding=attempts===1?'AVAILABLE':'RECOVERED';break;}
          if([403,429].includes(status)){finding='RESTRICTED';break;}
          if(response.ok){finding='INVALID_CONTENT';break;}
          finding=[404,410].includes(status)?'BROKEN_URL':'HTTP_ERROR';
        }catch{status=null;finding='NETWORK_UNVERIFIED';}
      }
      assets.push({...target,status,available,finding,attempts});
    }
  }));
  assets.sort((a,b)=>a.url.localeCompare(b.url));rightsReviewRequired.sort();
  return {assets,failed:assets.filter(a=>!a.available).length,rightsReviewRequired};
}
export function mediaReviewComplete(audit:MediaAudit,permissions:MediaPermission[]):boolean{
  return audit.failed===0&&audit.rightsReviewRequired.every(url=>permissions.some(p=>{
    if(p.url!==url||typeof p.rightsBasis!=='string'||p.rightsBasis.trim().length<20)return false;
    try{const u=new URL(p.licenceSource);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;}catch{return false;}
  }));
}
