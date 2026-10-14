import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

interface Page<T> {items:T[];page:number;limit:number}
function identity(item:unknown):unknown {
  const value=item as {id?:string;movie?:{id:string};booking?:{id:string}}
  return value.id ?? value.movie?.id ?? value.booking?.id ?? item
}
export function usePagedAsync<T>(key:string,load:(signal:AbortSignal)=>Promise<Page<T>>,page:number,pollMs=0) {
  const [revision,reload]=useReducer((n:number)=>n+1,0)
  type Result={key:string;pages:Page<T>[];revision:number;error?:Error}
  const [result,setResult]=useState<Result>({key:'',pages:[],revision:0})
  const previous=useRef(result)
  useEffect(()=>{
    const controller=new AbortController(),old=previous.current
    const same=old.key===key
    const cached=same?old.pages:[]
    // Callers request a single page; mutation actions reset to page one so
    // shifted offsets are not stitched onto the pre-mutation window.
    load(controller.signal).then(data=>{
      if(controller.signal.aborted)return
      const pages=page===1?[data]:[...cached.slice(0,page-1),data]
      const next={key,pages,revision};previous.current=next;setResult(next)
    },reason=>{
      if(controller.signal.aborted)return
      const next={key,pages:same?old.pages:[],revision,error:reason instanceof Error?reason:new Error('Unable to load more.')}
      previous.current=next;setResult(next)
    })
    return()=>controller.abort()
  },[key,load,page,revision])
  const refresh=useCallback(()=>reload(),[])
  useEffect(()=>{
    // Lists refresh via their existing page-reset actions. Poll only page one:
    // changing offsets while scrolling must not lose earlier rows.
    if(!pollMs||page!==1)return
    const timer=window.setInterval(refresh,pollMs)
    return()=>clearInterval(timer)
  },[pollMs,page,refresh])
  const pages=result.key===key?result.pages:[],last=pages.at(-1)
  const items=[...new Map(pages.flatMap(p=>p.items).map(item=>[identity(item),item])).values()]
  const error=result.key===key?result.error:undefined
  const pending=!error&&(result.key!==key||result.revision!==revision||pages.length<page)
  return {data:last?{...last,items}:undefined,loading:!last&&!error,error:!last?error:undefined,
    moreError:last?error:undefined,loadingMore:!!last&&pending,hasMore:!!last&&last.items.length>=last.limit,reload:refresh}
}
