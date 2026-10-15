import { useCallback, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { bookingApi } from '../api/booking'
import { useSession } from '../app/session-context'
import { useAsync } from '../app/use-async'
import { useCountdown } from '../app/use-countdown'
import { BookingFacts } from '../components/BookingFacts'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorState, Loading } from '../components/feedback'
import { bookingState } from '../domain/booking-state'
import { formatCountdown, money } from '../domain/time'
import { RefundDetails } from '../components/RefundDetails'
import { bookingStartsAt, confirmedCancellationAllowed } from '../domain/booking-target'
import type { BookingSummary } from '../api/types'

const titles = { confirmed: 'Payment Successful', pending: 'Awaiting payment confirmation', failed: 'Booking not completed',
  cancelled: 'Booking cancelled', 'refund-pending': 'Refund In Process', refunded: 'Refund Completed', compensation: 'Payment received' }
function markBookingCancelled(summary: BookingSummary): BookingSummary {
  if (summary.show === null) return { ...summary, booking: { ...summary.booking, status: 'CANCELLED' } }
  return { ...summary, booking: { ...summary.booking, status: 'CANCELLED' } }
}
export function BookingPage() {
  const { id = '' } = useParams(), session = useSession()
  const load = useCallback((signal: AbortSignal) => bookingApi.summary(id, signal), [id])
  const resource = useAsync(`booking:${session.user!.id}:${id}`, load, 5000)
  const remaining = useCountdown(resource.data?.booking.expiresAt ?? '')
  const cancellationWindow = useCountdown(resource.data ? new Date(Date.parse(resource.data.booking.createdAt) + 24 * 60 * 60 * 1000).toISOString() : '') > 0
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null)
  const [cancelledBookingId, setCancelledBookingId] = useState<string | null>(null)
  const actionRef = useRef<HTMLButtonElement | null>(null)
  if (resource.loading) return <main className="page-shell"><Loading label="Checking booking status…" /></main>
  if (resource.error) return <main className="page-shell"><ErrorState error={resource.error} retry={resource.reload} /></main>
  const loadedSummary = resource.data!
  const summary: BookingSummary = cancelledBookingId === id && loadedSummary.booking.status !== 'CANCELLED'
    ? markBookingCancelled(loadedSummary)
    : loadedSummary
  const { booking, payment, refunds } = summary, state = bookingState(booking, payment)
  const successfulPayment = payment && ['SUCCESS', 'REFUND_PENDING', 'REFUNDED'].includes(payment.status)
  const canCancel = state === 'confirmed' && cancellationWindow && confirmedCancellationAllowed(booking.createdAt, bookingStartsAt(summary))
  const title = state === 'confirmed' ? successfulPayment ? titles.confirmed : 'Booking confirmed'
    : payment?.status === 'FAILED' && state !== 'cancelled' ? 'Payment Failed'
    : state === 'pending' && payment?.status === 'SUCCESS' ? 'Payment received, confirmation pending' : titles[state]
  const outcomeTone = state === 'confirmed' || state === 'refunded' ? 'text-green-400'
    : state === 'failed' || payment?.status === 'FAILED' ? 'text-red-300' : 'text-amber-300'
  const run = async (action: 'cancel' | 'refund' | 'release') => {
    setBusy(true); setError(null)
    try {
      if (action === 'cancel') {
        const result = await bookingApi.cancel(id)
        if (result.booking.status !== 'CANCELLED') throw new Error('Cancellation was not confirmed.')
        setCancelledBookingId(id)
      } else if (action === 'refund') await bookingApi.retryRefund(id)
      else await bookingApi.release(id)
      setConfirm(false); resource.reload(); actionRef.current?.focus() }
    catch { setError(new Error('We couldn’t update this booking. Please refresh its status and try again.')); resource.reload() }
    finally { setBusy(false) }
  }
  return <main className="mx-auto max-w-4xl px-6 py-12"><div className="text-center">
    <div className={`outcome-icon ${outcomeTone}`} aria-hidden="true">{state === 'confirmed' ? '✓' : state === 'refunded' ? '↩' : state === 'failed' || payment?.status === 'FAILED' ? '×' : '…'}</div>
    <h1 className="mt-5 text-3xl font-semibold sm:text-4xl">{title}</h1>
    <p className="muted mt-3">{state === 'confirmed' ? 'Booking confirmed. Your ticket is ready.' : payment?.status === 'FAILED' && state !== 'cancelled' ? 'The payment could not be completed. No successful payment is recorded for this booking.' : booking.status === 'FAILED' && ['refund-pending', 'refunded', 'compensation'].includes(state)
      ? `Payment received. Booking could not be completed. ${state === 'refunded' ? 'Your full refund has been completed by the payment provider.' : state === 'refund-pending' ? 'Refund Processing — your full payment is being returned.' : 'A full refund is due. Check your refund progress here.'}`
      : state === 'refunded' ? 'Your booking is cancelled. Your refund has been completed by the payment provider; your bank may take additional time to credit it.'
      : state === 'refund-pending' ? 'Your booking is cancelled. Your full refund is being processed.'
      : state === 'failed' ? 'This booking could not be completed. No successful payment is recorded for this booking.'
      : state === 'cancelled' ? 'Your booking has been cancelled.' : 'Check your payment progress here. A ticket is ready only when your booking is confirmed.'}</p>
  </div>
    {state === 'pending' && <p className="muted mt-5 text-center text-sm">Tickets are confirmed after successful payment. If the booking cannot be completed, your payment will be refunded. Timing depends on your bank and payment provider.</p>}
    <div className="mt-8"><BookingFacts summary={summary} /></div>
    <div className="mt-7 flex flex-wrap justify-center gap-3 print:hidden">
      {state === 'confirmed' && <button className="btn" onClick={() => window.print()}>Download ticket / print</button>}
      <Link className="secondary" to="/bookings">View My Bookings</Link>
      {booking.status === 'PENDING' && remaining > 0 && (!payment || payment.status === 'PENDING') && <Link className="btn" to={`/bookings/${id}/checkout`}>Continue checkout • {formatCountdown(remaining)}</Link>}
      {canCancel && <button ref={actionRef} className="danger-outline" onClick={() => setConfirm(true)} disabled={busy}>Cancel booking</button>}
      <Link className="secondary" to="/help">Having an issue? Contact Support</Link>
      {(payment?.status === 'REFUND_PENDING' || refunds.some(refund => refund.status === 'PENDING') || state === 'compensation') && <button className="secondary" disabled={busy} onClick={() => run('refund')}>{busy ? 'Checking refund…' : 'Retry / check refund'}</button>}
    </div>
    {state === 'confirmed' && !canCancel && <p className="muted mt-4 text-center text-sm">This booking is outside the cancellation period.</p>}
    <RefundDetails refunds={refunds} ticketValid={state === 'confirmed'} />
    {error && <div className="mt-6"><ErrorState error={error} retry={resource.reload} /></div>}
    {confirm && canCancel && <ConfirmDialog busy={busy} onClose={() => setConfirm(false)}>
      <h2 id="cancel-title" className="text-2xl font-semibold">Cancel booking?</h2><p className="muted mt-4">Your seats will be released and a full refund of your payment will be requested. Your booking stays cancelled while your refund is being processed.</p>
      <p className="mt-3">Payment received: {payment ? money(payment.amountPaise) : 'Check your payment status'}</p><div className="mt-6 flex flex-wrap gap-3">
        <button className="secondary" onClick={() => { setConfirm(false); actionRef.current?.focus() }} disabled={busy}>Keep booking</button>
        <button className="btn" onClick={() => run('cancel')} disabled={busy}>{busy ? 'Cancelling…' : 'Confirm cancellation'}</button></div>
    </ConfirmDialog>}
  </main>
}
