import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from '../src/App'
import { ids, mockApi, ok, payment, summary } from './fixtures'

it('keeps the exact demo receipt disclaimer visible outside collapsed content before printing', async () => {
  window.history.replaceState({}, '', `/bookings/${ids.booking}`)
  sessionStorage.setItem('cinehook.access-token', 'unit-access-token')
  mockApi(path => path === `/api/bookings/${ids.booking}/summary` ? ok({ ...summary, booking: { ...summary.booking, status: 'CONFIRMED' }, payment: { ...payment, status: 'SUCCESS' } })
    : path.endsWith('/quote') ? ok({ version: 0, label: 'Order summary', couponCode: null, subtotalPaise: 12345, totalPaise: 12345, frozen: true, simulated: true }) : undefined)
  render(<App />)
  const notice = await screen.findByText('DEMO RECEIPT — NOT A TAX INVOICE')
  expect(notice).toBeVisible()
  expect(notice.closest('details, .print\\:hidden')).toBeNull()
  expect(screen.getByRole('button', { name: 'Download ticket / print' })).toBeEnabled()
})
