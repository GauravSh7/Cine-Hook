import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useCallback } from 'react'
import { usePagedAsync } from '../src/app/use-paged-async'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import App from '../src/App'
import { booking, failure, mockApi, ok, summary } from './fixtures'

it('history appends automatically, preserves earlier rows and retries a failed next page', async()=>{
  sessionStorage.setItem('cinehook.access-token','unit-access-token')
  window.history.replaceState({},'','/bookings')
  const observers=new Set<() => void>(); let rejectNext=true
  vi.stubGlobal('IntersectionObserver',class {
    callback:IntersectionObserverCallback
    constructor(callback:IntersectionObserverCallback){this.callback=callback}
    observe(target:Element){observers.add(()=>this.callback([{isIntersecting:true,target} as IntersectionObserverEntry],this as unknown as IntersectionObserver))}
    disconnect(){}
    unobserve(){}
  })
  const first=Array.from({length:20},(_,i)=>({...booking,id:`10000000-0000-4000-8000-${String(i+100).padStart(12,'0')}`}))
  const next={...booking,id:'10000000-0000-4000-8000-000000000999'}
  const calls=mockApi((path,_options,url)=>{
    if(path==='/api/bookings') {
      const p=Number(url.searchParams.get('page')??1)
      if(p===2&&rejectNext)return failure(503,'UNAVAILABLE','Unavailable')
      return ok({items:p===1?first:[first[19],next],page:p,limit:20})
    }
    if(path.endsWith('/summary'))return ok({...summary,booking:{...booking,id:path.split('/')[3]}})
  })
  render(<App/>);await screen.findByText(first[0].id)
  expect(screen.queryByRole('button',{name:'Previous'})).not.toBeInTheDocument()
  expect(screen.queryByText('Page 1')).not.toBeInTheDocument()
  await waitFor(()=>expect(observers.size).toBeGreaterThan(0))
  act(()=>observers.forEach(cb=>cb()))
  await screen.findByRole('button',{name:'Retry loading more'})
  expect(screen.getByText(first[0].id)).toBeVisible()
  rejectNext=false;await userEvent.click(screen.getByRole('button',{name:'Retry loading more'}))
  await screen.findByText(next.id)
  expect(screen.getAllByText(first[19].id)).toHaveLength(1)
  // Initial page, one failed read plus its bounded transport retry, then manual retry.
  expect(calls.filter(c=>c.path==='/api/bookings')).toHaveLength(4)
});

it('filter/identity changes abort stale responses and never mix earlier rows into the new list',async()=>{
  let finish!:(data:{items:{id:string}[];page:number;limit:number})=>void
  let oldSignal!:AbortSignal
  const load=vi.fn((key:string,signal:AbortSignal)=>{
    if(key==='old') {oldSignal=signal;return new Promise<{items:{id:string}[];page:number;limit:number}>(resolve=>{finish=resolve})}
    return Promise.resolve({items:[{id:'new-item'}],page:1,limit:20})
  })
  const hook=renderHook(({key})=>usePagedAsync(key,useCallback((signal:AbortSignal)=>load(key,signal),[key]),1),{initialProps:{key:'old'}})
  hook.rerender({key:'new'})
  await waitFor(()=>expect(hook.result.current.data?.items).toEqual([{id:'new-item'}]))
  expect(oldSignal.aborted).toBe(true)
  await act(async()=>finish({items:[{id:'stale-item'}],page:1,limit:20}))
  expect(hook.result.current.data?.items).toEqual([{id:'new-item'}])
  expect(hook.result.current.hasMore).toBe(false)
});
