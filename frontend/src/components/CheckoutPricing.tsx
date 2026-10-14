import { useState } from 'react'
import type { PricingQuote, TaxLine } from '../api/pricing'
import { money } from '../domain/time'
export function CheckoutPricing({quote,busy,onCoupon}:{quote:PricingQuote;busy:boolean;onCoupon:(code:string|null)=>Promise<void>}) {
  const [code,setCode]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('')
  const submit=async(value:string|null)=>{setSaving(true);setError('');try{await onCoupon(value)}catch(e){setError(e instanceof Error?e.message:'Coupon could not be applied.')}finally{setSaving(false)}}
  const disabled=busy||saving||quote.frozen
  const row=(label:string,value:number,className='')=><div className={`flex justify-between gap-4 ${className}`}><dt>{label}</dt><dd className="shrink-0">{money(value)}</dd></div>
  const grouped=new Map<string,TaxLine>()
  for(const line of quote.taxes??[]) {const key=`${line.name}:${line.rateBps}`,old=grouped.get(key);grouped.set(key,{...line,amountPaise:line.amountPaise+(old?.amountPaise??0)})}
  return <section className="checkout-pricing">
    {quote.simulated&&<p className="muted mt-4 text-xs">Test bill · Not a tax invoice</p>}
    {quote.version===1&&<div className="coupon-panel"><h3 className="font-semibold">Apply Coupon</h3><form className="mt-3 flex gap-2" onSubmit={e=>{e.preventDefault();void submit(code.trim().toUpperCase())}}><label className="sr-only" htmlFor="checkout-coupon">Coupon code</label><input id="checkout-coupon" className="input min-w-0 uppercase" maxLength={20} value={code} onChange={e=>setCode(e.target.value)} placeholder="Enter code" disabled={disabled}/><button className="secondary" disabled={disabled||!code.trim()}>{saving?'Applying…':'Apply'}</button></form>
    {quote.couponCode&&<p className="mt-3 text-sm text-emerald-300">{quote.couponCode} applied <button className="ml-3 underline" disabled={disabled} onClick={()=>void submit(null)}>Remove</button></p>}
    {quote.frozen&&<p className="muted mt-2 text-xs">Your payment total is fixed.</p>}{error&&<p className="mt-3 text-sm text-rose-300" role="alert">{error}</p>}</div>}
    <details className="bill-accordion mt-5"><summary className="cursor-pointer py-3 font-semibold">Show Bill</summary><div className="bill-body"><p className="muted mb-4 text-xs">Order summary</p><dl className="space-y-3 text-sm">
      {row('Ticket subtotal',quote.subtotalPaise)}{quote.version===1&&<>{row(quote.couponCode?`${quote.couponCode} discount`:'Coupon discount',-(quote.discountPaise??0),'text-emerald-300')}{row('Discounted tickets (GST-inclusive)',quote.discountedPaise!)}{row('Ticket taxable base',quote.ticketBasePaise!)}{row('Admission GST (included above)',quote.admissionTaxPaise!)}
      {[...grouped.entries()].map(([key,line])=><div className="flex justify-between gap-3 pl-3 text-xs text-slate-400" key={key}><dt>{line.name} {line.rateBps/100}% · included</dt><dd>{money(line.amountPaise)}</dd></div>)}
      {quote.feeWaived?<div className="flex justify-between gap-4"><dt>Platform fee</dt><dd className="flex gap-2"><del className="muted">{money(quote.feeOriginalPaise??700)}</del><span className="font-semibold text-emerald-300">Free</span></dd></div>:<>{row('Platform fee',quote.feePaise!)}{row('Platform-fee GST',quote.feeTaxPaise!)}</>}</>}
      <div className="divider"/>{row('Total payable',quote.totalPaise,'text-base font-semibold')}</dl><p className="muted mt-4 text-xs">GST rates may change under government rules.{quote.simulated?' This bill uses test assumptions.':''}</p></div></details>
  </section>
}
