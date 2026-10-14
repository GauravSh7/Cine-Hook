import { useState } from 'react'
const filters = ['All','UPI','Net Banking','Credit Card','Debit Card']
const offers = [
  {code:'FIRST50',title:'FIRST BOOKING — 50% OFF',description:'Get 50% off your ticket subtotal on your first booking.',terms:'First successfully paid booking across movies and supported events. No cap. Fees are excluded.'},
  {code:'SAVE10',title:'SAVE 10% — UP TO ₹100',description:'Save 10% on eligible tickets, up to ₹100.',terms:'One coupon per booking. No stacking. Fees are excluded.'},
]
export function OffersPage() {
  const [selected,setSelected]=useState('All'),[revealed,setRevealed]=useState<string[]>([]),[message,setMessage]=useState('')
  const copy=async(code:string)=>{try{await navigator.clipboard.writeText(code);setMessage(`${code} copied`)}catch{setMessage(`Copy this code: ${code}`)}}
  const visibleOffers = selected === 'All' ? offers : []
  return <main className="page-shell"><section className="offers-hero"><div><h1>Big screens.<br/>Better savings.</h1><p>Make your next booking count.</p></div><span className="offer-hero-percent" aria-hidden="true">%</span></section>
    <div className="filter-tabs" role="tablist" aria-label="Offer categories">{filters.map((filter,index)=><button id={`offer-${index}`} key={filter} role="tab" aria-selected={selected===filter} aria-controls="offer-results" tabIndex={selected===filter?0:-1} className={selected===filter?'btn':'secondary'} onClick={()=>setSelected(filter)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?filters.length-1:(index+(event.key==='ArrowRight'?1:-1)+filters.length)%filters.length;setSelected(filters[next]!);document.getElementById(`offer-${next}`)?.focus()}}}>{filter}</button>)}</div>
    <section id="offer-results" role="tabpanel" aria-labelledby={`offer-${filters.indexOf(selected)}`}>{visibleOffers.length ? <><p className="muted mb-5 text-sm">Ticket offers apply across supported payment methods.</p><div className="offer-grid">{visibleOffers.map((offer,index)=><article className={`promo-card promo-${index}`} key={offer.code}><span className="promo-number" aria-hidden="true">{index?'10%':'50%'}</span><div className="relative"><h2 className="text-2xl font-bold">{offer.title}</h2><p className="mt-3">{offer.description}</p><p className="muted mt-5 text-sm">{offer.terms}</p><div className="mt-6 flex flex-wrap items-center gap-3">{revealed.includes(offer.code)?<><code className="promo-code">{offer.code}</code><button className="secondary" onClick={()=>void copy(offer.code)}>Copy Code</button></>:<button className="btn" onClick={()=>setRevealed(current=>[...current,offer.code])}>Get Code</button>}</div></div></article>)}</div></> : <p className="offer-empty muted" role="status">No offers are available for {selected} right now.</p>}</section><p className="mt-4 text-sm text-emerald-300" role="status">{message}</p>
  </main>
}
