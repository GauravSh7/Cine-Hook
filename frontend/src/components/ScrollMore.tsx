import { useEffect, useRef } from 'react'

export function ScrollMore({hasMore,loadingMore,moreError,next,retry}:{hasMore:boolean;loadingMore:boolean;moreError?:Error;next:()=>void;retry:()=>void}) {
  const target=useRef<HTMLDivElement>(null),requested=useRef(false)
  useEffect(()=>{
    requested.current=false
    if(!hasMore||loadingMore||moreError||!target.current)return
    const advance=()=>{if(!requested.current){requested.current=true;next()}}
    if(typeof IntersectionObserver==='undefined'){
      const check=()=>{if(target.current&&target.current.getBoundingClientRect().top<window.innerHeight+240)advance()}
      window.addEventListener('scroll',check,{passive:true});window.addEventListener('resize',check)
      check();return()=>{window.removeEventListener('scroll',check);window.removeEventListener('resize',check)}
    }
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))advance()},{rootMargin:'240px'})
    observer.observe(target.current);return()=>observer.disconnect()
  },[hasMore,loadingMore,moreError,next])
  return <div ref={target} className="mt-6 min-h-1" aria-live="polite">{loadingMore&&<p className="muted">Loading more…</p>}{moreError&&<div><p role="alert">{moreError.message}</p><button className="secondary" onClick={retry}>Retry loading more</button></div>}</div>
}
