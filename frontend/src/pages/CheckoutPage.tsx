import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { bookingApi } from '../api/booking'
import { pricingApi } from '../api/pricing'
import { CheckoutPricing } from '../components/CheckoutPricing'
import { paymentApi } from '../api/payment'
import { useSession } from '../app/session-context'
import { useAsync } from '../app/use-async'
import { useCountdown } from '../app/use-countdown'
import { BookingFacts } from '../components/BookingFacts'
import { ErrorState, Loading } from '../components/feedback'
import { formatCountdown, money, remainingHoldMs } from '../domain/time'
import { loadRazorpay, type RazorpayInstance } from '../domain/razorpay'
import { bookingTitle } from '../domain/booking-target'

export function CheckoutPage() {
  const { id = '' } = useParams(), session = useSession(), navigate = useNavigate()
  const load = useCallback((signal: AbortSignal) => bookingApi.summary(id, signal), [id])
  const resource = useAsync(`checkout:${session.user!.id}:${id}`, load, 5000)
  const loadQuote = useCallback((signal:AbortSignal)=>pricingApi.quote(id,signal),[id])
  const pricing = useAsync(`pricing:${session.user!.id}:${id}`,loadQuote)
  const remaining = useCountdown(resource.data?.booking.expiresAt ?? '')
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null)
  const [couponBusy,setCouponBusy]=useState(false)
  const sdk = useRef<RazorpayInstance | null>(null), live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false; sdk.current?.close() } }, [])
  useEffect(() => { if (resource.data && resource.data.booking.status !== 'PENDING') navigate(`/bookings/${id}`, { replace: true }) }, [resource.data, id, navigate])
  const expiry = resource.data?.booking.expiresAt
  const refresh = resource.reload
  useEffect(() => { if (expiry && remaining === 0) refresh() }, [expiry, remaining, refresh])
  if (resource.loading) return <main className="page-shell"><Loading label="Loading your booking…" /></main>
  if (resource.error) return <main className="page-shell"><ErrorState error={resource.error} retry={resource.reload} /></main>
  const summary = resource.data!, payable = !!pricing.data && pricing.data.paymentAllowed !== false && !pricing.error && !pricing.loading && summary.booking.status === 'PENDING' && remaining > 0 && (!summary.payment || summary.payment.status === 'PENDING')
  const finalAmount = pricing.data?.totalPaise
  const pay = async () => {
    if (!payable || busy || couponBusy) return
    setBusy(true); setError(null)
    try {
      const { order, expiresAt } = await paymentApi.order(id)
      pricing.replace(await pricingApi.quote(id))
      const Razorpay = await loadRazorpay()
      if (!live.current) return
      if (remainingHoldMs(expiresAt) === 0) throw new Error('Your hold has expired. Check booking status before trying again.')
      let verifying = false, cancelling = false
      const abandon = async () => {
        if(!live.current||verifying||cancelling)return
        cancelling=true
        try{await bookingApi.cancelCheckout(id);checkout.close();if(live.current)navigate(`/bookings/${id}`,{replace:true})}
        catch(value){if(live.current){setError(value instanceof Error?value:new Error('Unable to cancel. Please check your booking.'));resource.reload()}}
        finally{if(live.current)setBusy(false)}
      }
      const checkout = new Razorpay({ key: order.keyId, order_id: order.id, amount: order.amountPaise, currency: order.currency,
        name: 'CineHook', description: bookingTitle(summary), prefill: { name: session.user!.name, email: session.user!.email }, theme: { color: '#e50914' },
        handler: async response => {
          if (verifying || !live.current) return
          verifying = true
          try { await paymentApi.verify({ bookingId: id, razorpay_order_id: response.razorpay_order_id, razorpay_payment_id: response.razorpay_payment_id, razorpay_signature: response.razorpay_signature })
            if (live.current) navigate(`/bookings/${id}`, { replace: true }) }
          catch { if (live.current) { setError(new Error('Payment verification is uncertain. Check booking status to recover; do not assume payment failed or pay twice.')); resource.reload() } }
          finally { if (live.current) setBusy(false) }
        }, modal: { confirm_close: true, ondismiss: () => {void abandon()} } })
      sdk.current = checkout
      checkout.on('payment.failed', () => {void abandon()})
      checkout.open()
    } catch (value) { if (live.current) { setError(value instanceof Error ? value : new Error('Secure checkout is unavailable.')); setBusy(false); resource.reload() } }
  }
  return <main className="mx-auto max-w-6xl px-6 py-10"><h1 className="text-4xl font-semibold">Checkout</h1>
    <p className="muted mt-2">Review your booking before proceeding to secure payment.</p>
    <p className="mt-4 text-sm" role="timer" aria-label="Payment countdown">Pay within <span className="accent font-semibold">{formatCountdown(remaining)}</span></p>
    {remaining === 0 && <p role="alert" className="mt-3 text-amber-300">Your hold has expired. Refresh your booking or select seats again.</p>}
    <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]"><BookingFacts summary={summary} checkout totalPaise={finalAmount} />
      <aside className="panel h-fit p-7"><h2 className="text-xl font-semibold">Price details</h2><dl className="mt-6 space-y-4 text-sm">
        <div className="flex justify-between"><dt className="muted">Ticket amount</dt><dd>{money(summary.booking.totalPaise)}</dd></div>
        <div className="divider" /><div className="flex justify-between text-base font-semibold"><dt>Total payable</dt><dd>{finalAmount===undefined?'—':money(finalAmount)}</dd></div></dl>
        {pricing.loading&&<p className="muted mt-4" role="status">Calculating your total…</p>}
        {pricing.data?.paymentAllowed===false&&<p className="muted mt-4 text-xs">Payments unavailable</p>}
        {pricing.error&&<div className="mt-4"><ErrorState error={pricing.error} retry={pricing.reload}/></div>}
        {pricing.data&&<CheckoutPricing quote={pricing.data} busy={busy||couponBusy} onCoupon={async code=>{
          setCouponBusy(true)
          try { pricing.replace(await pricingApi.coupon(id,code)) }
          finally { setCouponBusy(false) }
        }}/>}
        <div className="muted mt-6 flex flex-wrap gap-2 text-xs">{['UPI', 'Cards', 'Net Banking'].map(method => <span className="rounded-full bg-[#1b1b24] px-3 py-2" key={method}>{method}</span>)}</div>
        <button className="btn mt-8 w-full" onClick={pay} disabled={!payable || busy || couponBusy}>{busy ? 'Checking payment…' : finalAmount===undefined?'Proceed to payment':`Proceed to payment • ${money(finalAmount)}`}</button>
        <button className="secondary cancel-payment mt-3 w-full" disabled={busy || couponBusy} onClick={async () => {
          setBusy(true); setError(null)
          try { await bookingApi.cancelCheckout(id); sdk.current?.close(); if(live.current) navigate(`/bookings/${id}`, {replace:true}) }
          catch(value) {if(live.current) {setError(value instanceof Error ? value : new Error('Unable to cancel. Please retry.'));resource.reload()} }
          finally {if(live.current) setBusy(false)}
        }}>Cancel payment</button>
      </aside></div>{error && <div className="mt-6"><ErrorState error={error} retry={resource.reload} /></div>}
  </main>
}
