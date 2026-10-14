import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import App from '../src/App'
import { profileAge } from '../src/domain/profile'
import { booking, ids, mockApi, movie, ok, payment, summary, user } from './fixtures'

function visit(path: string) {
  sessionStorage.setItem('cinehook.access-token', 'unit-access-token')
  window.history.replaceState({}, '', path)
}

it.each([
  ['2000-10-11', '2026-10-10T12:00:00', 25],
  ['2000-10-11', '2026-10-11T00:00:00', 26],
  ['2000-10-11', '2027-10-11T00:00:00', 27],
  ['2000-02-29', '2027-02-28T12:00:00', 26],
  ['2000-02-29', '2027-03-01T00:00:00', 27],
] as const)('calculates DOB %s at %s as %s without a stored age', (birth, today, age) => {
  expect(profileAge(birth, new Date(today))).toBe(age)
})

it('does not guess an age when DOB is absent and keeps age non-editable', async () => {
  visit('/account'); mockApi(); render(<App />)
  const age = await screen.findByLabelText('Age')
  expect(age).toHaveValue('Not provided')
  expect(age).toHaveAttribute('readonly')
})

it('updates the displayed age when an open account page crosses a birthday', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T23:59:59'))
  try {
    visit('/account')
    mockApi(path => path === '/api/auth/me' ? ok({ user: { ...user, dateOfBirth: '2000-10-11' } }) : undefined)
    render(<App />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByLabelText('Age')).toHaveValue('25')
    await act(async () => { await vi.advanceTimersByTimeAsync(1001) })
    expect(screen.getByLabelText('Age')).toHaveValue('26')
  } finally { vi.useRealTimers() }
})

it('answers the five customer questions without technical jargon or guaranteed refund deadlines', async () => {
  visit('/help'); mockApi(); render(<App />)
  const faq = screen.getByRole('region', { name: 'Frequently asked questions' })
  const questions = [
    'How do I book a movie ticket?', 'How do I select or change my city?',
    'How can I cancel my booking and request a refund?', 'How long does it take to receive my refund?',
    'Where can I see my booked tickets and payment status?',
  ]
  expect(within(faq).getAllByRole('button')).toHaveLength(5)
  for (const question of questions) {
    const button = within(faq).getByRole('button', { name: question })
    await userEvent.click(button)
    const answer = document.getElementById(button.getAttribute('aria-controls')!)!
    expect(answer).toBeVisible()
    expect(answer).not.toHaveTextContent(/Redis|backend|APIs|locks|transactions|webhooks|database tables/i)
    if (question.includes('long')) {
      expect(answer).toHaveTextContent(/provider.*bank|bank.*provider/i)
      expect(answer).not.toHaveTextContent(/\d+\s*[-–]?\s*\d*\s*(business|working)?\s*days/i)
    }
    if (question.includes('cancel')) {
      expect(answer).toHaveTextContent(/within 24 hours of booking/i)
      expect(answer).toHaveTextContent(/Same-day bookings cannot be cancelled/i)
    }
  }
  expect(screen.queryByText('CINEHOOK SUPPORT')).not.toBeInTheDocument()
})

const attempt = { id: 'attempt-unit', sequence: 1, providerRefundId: 'rfnd_customer_evidence', status: 'PENDING' as const, lastErrorCode: null, processedAt: null }
const refund = { id: 'refund-local-record', providerPaymentId: 'pay_customer_evidence', amountPaise: 12345, currency: 'INR', reason: 'BOOKING_CANCELLED', status: 'PENDING' as const, attempts: [attempt] }
const captured = { ...payment, providerPaymentId: 'pay_customer_evidence', status: 'SUCCESS', capturedAt: '2026-10-10T06:00:00Z' }

it.each([
  { name: 'captured and confirmed', title: 'Payment Successful', bookingStatus: 'CONFIRMED', payment: captured, refunds: [], ticket: true },
  { name: 'failed with no capture', title: 'Payment Failed', bookingStatus: 'FAILED', payment: { ...payment, status: 'FAILED', failureCode: 'PRIVATE_PROVIDER_REASON' }, refunds: [], ticket: false },
  { name: 'failed payment with an unexpired pending booking', title: 'Payment Failed', bookingStatus: 'PENDING', payment: { ...payment, status: 'FAILED', failureCode: 'PRIVATE_PROVIDER_REASON' }, refunds: [], ticket: false },
  { name: 'captured but unfulfilled', title: 'Payment received', bookingStatus: 'FAILED', payment: { ...captured, reconciliation: { reason: 'PRIVATE_INTERNAL_REASON', compensationRequired: true, resolvedAt: null } }, refunds: [], ticket: false },
  { name: 'pending compensation', title: 'Refund In Process', bookingStatus: 'FAILED', payment: { ...captured, status: 'REFUND_PENDING' }, refunds: [{ ...refund, reason: 'PAID_UNFULFILLED' }], ticket: false },
  { name: 'cancelled and refund pending', title: 'Refund In Process', bookingStatus: 'CANCELLED', payment: { ...captured, status: 'REFUND_PENDING' }, refunds: [refund], ticket: false },
  { name: 'cancelled and refunded', title: 'Refund Completed', bookingStatus: 'CANCELLED', payment: { ...captured, status: 'REFUNDED' }, refunds: [{ ...refund, status: 'REFUNDED', attempts: [{ ...attempt, status: 'PROCESSED', processedAt: '2026-10-10T06:15:00Z' }] }], ticket: false },
])('renders authoritative customer financial details for $name', async item => {
  visit(`/bookings/${ids.booking}`)
  mockApi(path => path.endsWith('/summary') ? ok({ ...summary, booking: { ...booking, status: item.bookingStatus, failureCode: 'HOLD_LOST' }, payment: item.payment, refunds: item.refunds }) : undefined)
  render(<App />)
  expect(await screen.findByRole('heading', { level: 1, name: item.title })).toBeVisible()
  expect(screen.queryByRole('link', { name: 'CineHook home' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /back to my bookings/i })).toHaveAttribute('href', '/bookings')
  expect(screen.queryByRole('link', { name: /Select seats again/i })).not.toBeInTheDocument()
  expect(screen.queryByText(/current backend booking|renewed or reacquired|Your cinema experience/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/PRIVATE_PROVIDER_REASON|PRIVATE_INTERNAL_REASON/)).not.toBeInTheDocument()
  expect(screen.getByText(ids.booking)).toBeVisible()
  expect(screen.getByText('Booking status').closest('div')).toHaveTextContent(item.bookingStatus)
  if (item.payment.status === 'FAILED') {
    expect(screen.queryByText('rfnd_customer_evidence')).not.toBeInTheDocument()
    expect(screen.queryByText('Amount paid')).not.toBeInTheDocument()
  } else {
    expect(screen.getAllByText('pay_customer_evidence').length).toBeGreaterThan(0)
    expect(screen.getByText('Amount paid')).toBeVisible()
  }
  if (item.refunds.length) {
    expect(screen.getByText('rfnd_customer_evidence')).toBeVisible()
    expect(screen.getByText('Refund amount')).toBeVisible()
    if (item.payment.status === 'REFUNDED') expect(screen.getByText('Completed at')).toBeVisible()
  }
  if (item.bookingStatus === 'FAILED' && item.refunds.length) expect(screen.getByText(/Payment received.*Booking could not be completed/)).toBeVisible()
  expect(Boolean(screen.queryByRole('button', { name: /Download ticket/i }))).toBe(item.ticket)
})

it('does not replace a missing provider refund ID or completion time with fabricated evidence', async () => {
  visit(`/bookings/${ids.booking}`)
  mockApi(path => path.endsWith('/summary') ? ok({ ...summary, booking: { ...booking, status: 'CANCELLED' }, payment: { ...captured, status: 'REFUND_PENDING' }, refunds: [{ ...refund, attempts: [] }] }) : undefined)
  render(<App />)
  await screen.findByRole('heading', { name: 'Refund In Process' })
  expect(screen.getByText('Not yet available')).toBeVisible()
  expect(screen.queryByText('refund-local-record')).not.toBeInTheDocument()
  expect(screen.queryByText('Completed at')).not.toBeInTheDocument()
})

it('does not infer financial success from a confirmed booking without a payment record', async () => {
  visit(`/bookings/${ids.booking}`)
  mockApi(path => path.endsWith('/summary') ? ok({ ...summary, booking: { ...booking, status: 'CONFIRMED' } }) : undefined)
  render(<App />)
  expect(await screen.findByRole('heading', { name: 'Booking confirmed' })).toBeVisible()
  expect(screen.queryByText('Payment Successful')).not.toBeInTheDocument()
  expect(screen.queryByText('Amount paid')).not.toBeInTheDocument()
})

it('keeps movie cards free of schedule metadata and unavailable labels', async () => {
  mockApi(); render(<App />)
  await screen.findByRole('heading', { level: 1, name: movie.title })
  expect(screen.queryByText('Browsing all supported cities')).not.toBeInTheDocument()
  expect(screen.queryByText('Demonstration screenings · Original illustrative artwork')).not.toBeInTheDocument()
  expect(screen.queryByText(/Next show|Rating unavailable|Showtimes coming soon/i)).not.toBeInTheDocument()
  expect(screen.getByRole('contentinfo')).not.toHaveTextContent(/sample|seed|fictional|demo/i)
  expect(screen.queryByText('Original illustration')).not.toBeInTheDocument()
})
