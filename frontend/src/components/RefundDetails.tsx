import type { Refund } from '../api/types'
import { StatusBadge } from './feedback'
import { formatDateTime, money } from '../domain/time'

export function RefundDetails({ refunds, ticketValid }: { refunds: Refund[]; ticketValid: boolean }) {
  if (!refunds.length) return null
  return <section className="panel refund-details mt-8 p-6">
    <h2 className="text-xl font-semibold">Refund details</h2>
    {ticketValid && <p className="muted mt-2 text-sm">A separate payment is being returned. Your confirmed ticket remains valid.</p>}
    <ul className="mt-5 space-y-5">{refunds.map(refund => {
      const evidence = [...refund.attempts].sort((a, b) => b.sequence - a.sequence)
        .find(attempt => attempt.providerRefundId && (refund.status === 'REFUNDED' ? attempt.status === 'PROCESSED' : ['PENDING', 'PROCESSED'].includes(attempt.status)))
      const completed = refund.status === 'REFUNDED' && evidence?.processedAt && Number.isFinite(Date.parse(evidence.processedAt)) ? evidence.processedAt : null
      return <li key={refund.id}><div className="flex flex-wrap justify-between items-center gap-3 mb-4"><p className="font-semibold">{refund.status === 'REFUNDED' ? 'Refund Completed' : 'Refund In Process'}</p><StatusBadge value={refund.status}/></div>
        <dl className="financial-facts"><div><dt>Refund amount</dt><dd>{money(refund.amountPaise)}</dd></div>
          <div><dt>Original payment ID</dt><dd>{refund.providerPaymentId}</dd></div>
          <div><dt>Refund ID</dt><dd>{evidence?.providerRefundId ?? 'Not yet available'}</dd></div>
          {completed && <div><dt>Completed at</dt><dd>{formatDateTime(completed)}</dd></div>}
        </dl>
      </li>
    })}</ul>
  </section>
}
