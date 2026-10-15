import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import App from '../src/App'
import { city, mockApi } from './fixtures'
import { booking, ids, ok, page, payment, summary } from './fixtures'

it('focused auth navigation preserves the requested destination', async () => {
  window.history.replaceState({}, '', '/login?returnTo=%2Fwishlist'); mockApi(); render(<App />)
  expect(screen.getByRole('tab', { name: 'Login' })).toHaveAttribute('href', '/login?returnTo=%2Fwishlist')
})

it('booking page tabs use authoritative summaries and label page counts with provider-driven refund tips', async () => {
  sessionStorage.setItem('cinehook.access-token', 'unit-access-token'); window.history.replaceState({}, '', '/bookings')
  mockApi(path => path === '/api/bookings' ? ok(page([{ ...booking, status: 'CONFIRMED' }])) : path === `/api/bookings/${ids.booking}/summary` ? ok({ ...summary, booking: { ...booking, status: 'CANCELLED' }, payment: { ...payment, status: 'REFUND_PENDING' } }) : undefined)
  render(<App />)
  const refunds = await screen.findByRole('tab', { name: 'Refunds (1)' }); await userEvent.click(refunds)
  expect(await screen.findByRole('link', { name: 'View status / refund' })).toBeVisible()
  expect(screen.queryByRole('link', { name: 'View ticket' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Resume checkout' })).not.toBeInTheDocument()
  expect(screen.getByText(/Counts reflect loaded bookings/)).toBeVisible()
  expect(screen.getByText(/provider.*refund/i)).toBeVisible()
  expect(screen.queryByText(/5.?7.*days/i)).not.toBeInTheDocument()
})

it('navigates categories with active state and provides a keyboard location modal with explicit save', async () => {
  mockApi(); render(<App />)
  const nav = screen.getByRole('navigation', { name: 'Categories' })
  expect(within(nav).getByRole('link', { name: 'Movies' })).toHaveAttribute('aria-current', 'page')
  await userEvent.click(await screen.findByRole('button', { name: 'All cities' }))
  const dialog = screen.getByRole('dialog', { name: 'Select your location' })
  await userEvent.type(within(dialog).getByLabelText('Search cities'), 'Noida')
  const cityChoice = await within(dialog).findByRole('radio', { name: city.name })
  await userEvent.click(cityChoice)
  expect(cityChoice).toBeChecked()
  expect(sessionStorage.getItem('cinehook.city')).not.toBe(city.id)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save location' }))
  expect(sessionStorage.getItem('cinehook.city')).toBe(city.id)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: city.name })); await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it.each(['/stream', '/events', '/sports', '/activities'])('renders %s with a truthful empty catalogue and no fake purchases', async path => {
  window.history.replaceState({}, '', path); mockApi(); render(<App />)
  expect(await screen.findByRole('heading', { name: 'No experiences found' })).toBeVisible()
  expect(screen.getAllByRole('searchbox')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: /book now|watch now/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /book now|watch now/i })).not.toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Categories' }).querySelector('[aria-current="page"]')).toHaveTextContent(new RegExp(path.slice(1), 'i'))
})
it('offers accessible payment-category filters with the two approved ticket offers and no card collection', async () => {
  window.history.replaceState({}, '', '/offers'); mockApi(); render(<App />)
  for (const category of ['All', 'UPI', 'Net Banking', 'Credit Card', 'Debit Card']) {
    const filter = screen.getByRole('tab', { name: category }); await userEvent.click(filter)
    expect(filter).toHaveAttribute('aria-selected', 'true')
    if (category === 'All') {
      expect(screen.getByRole('tabpanel')).toHaveTextContent('FIRST BOOKING — 50% OFF')
      expect(screen.getByRole('tabpanel')).toHaveTextContent('SAVE 10% — UP TO ₹100')
    } else {
      expect(screen.getByRole('tabpanel')).toHaveTextContent(`No offers are available for ${category}`)
      expect(screen.getByRole('tabpanel')).not.toHaveTextContent('FIRST BOOKING — 50% OFF')
      expect(screen.getByRole('tabpanel')).not.toHaveTextContent('SAVE 10% — UP TO ₹100')
    }
  }
  expect(screen.queryByLabelText(/card number|cvv/i)).not.toBeInTheDocument()
})
it('normal browsing menu opens account destinations', async () => {
  sessionStorage.setItem('cinehook.access-token', 'unit-access-token')
  window.history.replaceState({}, '', '/'); mockApi(); render(<App />)
  expect(screen.getByRole('navigation', { name: 'Categories' })).toBeVisible()
  await userEvent.click(await screen.findByRole('button', { name: /Cinema Fan account menu/i }))
  expect(screen.getByRole('navigation', { name: 'Account menu' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'My Wishlist' })).toHaveAttribute('href', '/wishlist')
  expect(screen.queryByRole('button', { name: /Google|Apple|Facebook/ })).not.toBeInTheDocument()
})
it('help provides customer FAQs without a chatbot option', async () => {
  window.history.replaceState({}, '', '/help'); mockApi(); render(<App />)
  expect(await screen.findByRole('region', { name: 'Frequently asked questions' })).toBeVisible()
  expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: /message/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /chat with us/i })).not.toBeInTheDocument()
  expect(screen.queryByText(/chatbot|AI support experience/i)).not.toBeInTheDocument()
})
