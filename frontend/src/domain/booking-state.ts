import type { Booking, Payment } from '../api/types'

export type BookingDisplayState = 'confirmed' | 'pending' | 'failed' | 'cancelled' | 'refund-pending' | 'refunded' | 'compensation'
export function bookingState(booking: Booking, payment: Payment | null): BookingDisplayState {
  // A successful primary booking remains valid during an extra-capture return.
  if (booking.status === 'CONFIRMED') return 'confirmed'
  if (payment?.status === 'REFUNDED') return 'refunded'
  if (payment?.status === 'REFUND_PENDING') return 'refund-pending'
  if (booking.status === 'CANCELLED') return 'cancelled'
  if (payment?.reconciliation?.compensationRequired && !payment.reconciliation.resolvedAt) return 'compensation'
  if (booking.status === 'FAILED') return payment?.status === 'SUCCESS' ? 'compensation' : 'failed'
  return 'pending'
}
