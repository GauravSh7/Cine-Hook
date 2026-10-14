import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Booking, Payment } from '../src/api/types'

const booking: Booking = { id: 'b1', showId: 's1', status: 'PENDING', totalPaise: 25000, expiresAt: '2026-10-07T10:05:00Z', confirmedAt: null, failureCode: null, createdAt: '2026-10-07T10:00:00Z', updatedAt: '2026-10-07T10:00:00Z', seats: [{ id: 'bs1', showId: 's1', seatId: 'a1', rowName: 'A', seatNumber: 1, seatType: 'REGULAR', pricePaise: 25000 }] }
const payment: Payment = { id: 'p1', bookingId: 'b1', amountPaise: 25000, currency: 'INR', status: 'SUCCESS', providerOrderId: 'order1', providerPaymentId: 'pay1', capturedAt: '2026-10-07T10:01:00Z', bookingFinalizedAt: null, failureCode: null, reconciliation: null }

afterEach(() => { vi.useRealTimers(); vi.resetModules(); document.head.querySelectorAll('script').forEach(script => script.remove()); delete window.Razorpay })

describe('booking display authority', () => {
  it('cuts off a hold exactly at backend expiry and fails closed for invalid dates', async () => {
    const { remainingHoldMs, formatCountdown } = await import('../src/domain/time')
    expect(remainingHoldMs('2026-10-07T10:05:00Z', Date.parse('2026-10-07T10:04:59.001Z'))).toBe(999)
    expect(remainingHoldMs('2026-10-07T10:05:00Z', Date.parse('2026-10-07T10:05:00Z'))).toBe(0)
    expect(remainingHoldMs('invalid', 0)).toBe(0)
    expect(remainingHoldMs('2026-10-07T10:05:00Z', NaN)).toBe(0)
    expect(formatCountdown(999)).toBe('00:01')
    expect(formatCountdown(-1)).toBe('00:00')
    expect(formatCountdown(61000)).toBe('01:01')
    expect(formatCountdown(300999)).toBe('05:00') // HTTP Date has only whole-second precision.
  })

  it('formats integer paise for display and makes UTC date filters explicit', async () => {
    const { money, utcDate, formatDateTime } = await import('../src/domain/time')
    expect(money(12345)).toBe('₹123.45')
    expect(utcDate('2026-10-07T23:30:00-05:00')).toBe('2026-10-08')
    expect(utcDate('invalid')).toBe('')
    expect(formatDateTime('invalid')).toBe('Unavailable')
    expect(formatDateTime('2026-10-07T10:00:00Z')).toContain('IST')
  })

  it('shows scheduled times and local midnight crossings in India Standard Time', async () => {
    const { formatDateTime, utcDate } = await import('../src/domain/time')
    expect(formatDateTime('2099-10-10T14:00:00Z')).toBe('10 Oct 2099, 07:30 pm IST')
    expect(formatDateTime('2099-10-10T20:00:00Z')).toBe('11 Oct 2099, 01:30 am IST')
    expect(utcDate('2099-10-10T20:00:00Z')).toBe('2099-10-10')
  })

  it.each([
    ['PENDING', 'SUCCESS', 'pending'],
    ['FAILED', 'SUCCESS', 'compensation'],
    ['CONFIRMED', 'SUCCESS', 'confirmed'],
    ['FAILED', 'FAILED', 'failed'],
    ['CANCELLED', 'SUCCESS', 'cancelled'],
    ['CANCELLED', 'REFUND_PENDING', 'refund-pending'],
    ['CANCELLED', 'REFUNDED', 'refunded'],
  ] as const)('interprets booking %s with payment %s as %s', async (bookingStatus, paymentStatus, expected) => {
    const { bookingState } = await import('../src/domain/booking-state')
    expect(bookingState({ ...booking, status: bookingStatus }, { ...payment, status: paymentStatus })).toBe(expected)
  })

  it('keeps a confirmed ticket valid while an extra payment needs compensation', async () => {
    const { bookingState } = await import('../src/domain/booking-state')
    expect(bookingState({ ...booking, status: 'CONFIRMED' }, { ...payment, reconciliation: { reason: 'EXTRA_CAPTURE', compensationRequired: true, resolvedAt: null } })).toBe('confirmed')
    expect(bookingState({ ...booking, status: 'FAILED' }, { ...payment, reconciliation: { reason: 'HOLD_LOST', compensationRequired: true, resolvedAt: null } })).toBe('compensation')
    expect(bookingState(booking, null)).toBe('pending')
  })
})

describe('official checkout SDK loading', () => {
  it('shares one load across callers and resolves only when the constructor is ready', async () => {
    const { loadRazorpay } = await import('../src/domain/razorpay')
    const first = loadRazorpay(); const second = loadRazorpay()
    const scripts = document.head.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0].src).toBe('https://checkout.razorpay.com/v1/checkout.js')
    const constructor = vi.fn() as unknown as NonNullable<Window['Razorpay']>
    window.Razorpay = constructor
    scripts[0].dispatchEvent(new Event('load'))
    expect(await first).toBe(constructor)
    expect(await second).toBe(constructor)
  })

  it('rejects SDK failure and allows an explicit later retry', async () => {
    const { loadRazorpay } = await import('../src/domain/razorpay')
    const failed = loadRazorpay().catch(value => value)
    document.head.querySelector('script')!.dispatchEvent(new Event('error'))
    expect(await failed).toMatchObject({ message: 'Unable to load secure checkout. Please try again.' })
    const retry = loadRazorpay().catch(value => value)
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
    document.head.querySelector('script')!.dispatchEvent(new Event('error'))
    await retry
  })

  it('bounds stalled SDK loading to ten seconds', async () => {
    vi.useFakeTimers()
    const { loadRazorpay } = await import('../src/domain/razorpay')
    const result = loadRazorpay().catch(value => value)
    await vi.advanceTimersByTimeAsync(10000)
    expect(await result).toMatchObject({ message: 'Secure checkout took too long to load. Please try again.' })
    expect(document.head.querySelectorAll('script')).toHaveLength(0)
  })
})
