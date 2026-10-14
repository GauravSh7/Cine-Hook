import {expect,it} from 'vitest';
import {catalogueGroup} from '../scripts/staging-shape.js';
import {auditCatalogueMedia,mediaReviewComplete} from '../scripts/staging-media.js';
it('makes one final bounded retry for transport failures, not HTTP restrictions',async()=>{
  let calls=0;const result=await auditCatalogueMedia([catalogueGroup('event',[{id:'a',imageUrl:'https://images.unsplash.com/photo-retry'}])],async()=>{
    if(++calls<3)throw new TypeError('transport');
    return new Response(null,{headers:{'content-type':'image/jpeg'}});
  });
  expect(calls).toBe(3);expect(result.assets[0]).toMatchObject({available:true,finding:'RECOVERED',attempts:3});
});
it('recovers a timed-out HEAD with a bounded GET check and labels actual missing images separately',async()=>{
  const attempts:Record<string,number>={};
  const result=await auditCatalogueMedia([catalogueGroup('event',[{id:'a',imageUrl:'https://images.unsplash.com/photo-ok'},{id:'b',imageUrl:'https://images.unsplash.com/photo-missing'}])],async(url)=>{
    const key=String(url);attempts[key]=(attempts[key]??0)+1;
    if(key.endsWith('photo-ok')&&attempts[key]===1)throw new TypeError('network');
    return key.endsWith('photo-ok')?new Response(null,{status:206,headers:{'content-type':'image/jpeg'}}):new Response(null,{status:404});
  });
  expect(result.assets.find(a=>a.url.endsWith('photo-ok'))).toMatchObject({available:true,finding:'RECOVERED',attempts:2});
  expect(result.assets.find(a=>a.url.endsWith('photo-missing'))).toMatchObject({available:false,finding:'BROKEN_URL',attempts:2});
});
it('reports rate limits as restrictions without retrying or claiming that the URL is broken',async()=>{
  let calls=0;const result=await auditCatalogueMedia([catalogueGroup('event',[{id:'a',imageUrl:'https://images.unsplash.com/photo-restricted'}])],async()=>{calls++;return new Response(null,{status:429});});
  expect(calls).toBe(1);expect(result.assets[0]).toMatchObject({available:false,finding:'RESTRICTED'});
});
it('checks deduplicated hosted images and required attribution assets without accepting HTML fallback as an image',async()=>{
  const urls:string[]=[];
  const groups=[catalogueGroup('movie',[{id:'a',posterUrl:'https://image.tmdb.org/t/p/w500/a.jpg',backdropUrl:'https://image.tmdb.org/t/p/w500/a.jpg',ratingSource:'TMDB'}])];
  const result=await auditCatalogueMedia(groups,async url=>{urls.push(String(url));return new Response(null,{status:200,headers:{'content-type':String(url).includes('tmdb-logo')?'text/html':'image/jpeg'}});});
  expect(urls.filter(u=>u.endsWith('a.jpg'))).toHaveLength(1);
  expect(result.assets.find(a=>a.url.includes('tmdb-logo'))?.available).toBe(false);
  expect(result.failed).toBe(1);
});
it('does not probe arbitrary hosts, private addresses, path traversal or credential-bearing URLs',async()=>{
  let probes=0;
  const groups=[catalogueGroup('event',[{id:'a',imageUrl:'https://127.0.0.1/private'}]),catalogueGroup('demoListing',[{id:'b',imageUrl:'/demo-art/../../.env'}]),catalogueGroup('movie',[{id:'c',posterUrl:'https://user:secret@image.tmdb.org/a.jpg'}])];
  const result=await auditCatalogueMedia(groups,async()=>{probes++;return new Response();});
  expect(probes).toBe(0);expect(result.failed).toBe(3);
  expect(JSON.stringify(result)).not.toContain('secret');
});
it('requires per-file rights review for Wikimedia instead of declaring all posters licensed',async()=>{
  const url='https://upload.wikimedia.org/wikipedia/en/a/a1/Film.jpg';
  const result=await auditCatalogueMedia([catalogueGroup('movie',[{id:'a',posterUrl:url}])],async()=>new Response(null,{headers:{'content-type':'image/jpeg'}}));
  expect(result.rightsReviewRequired).toEqual([url]);
  expect(mediaReviewComplete(result,[])).toBe(false);
  expect(mediaReviewComplete(result,[{url,licenceSource:'https://en.wikipedia.org/wiki/File:Film.jpg',rightsBasis:'Per-file permission reviewed for this specific portfolio use'}])).toBe(true);
});
