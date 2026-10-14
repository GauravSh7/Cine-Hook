import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import App from '../src/App'
import { ids, mockApi, movie, ok, page, payment, show, user } from './fixtures'

const admin = { ...user, role: 'ADMIN' }
function visit(path: string) { sessionStorage.setItem('cinehook.access-token', 'unit-admin-token'); window.history.replaceState({}, '', path) }
function adminApi(override?: (path: string, options: RequestInit) => Response | Promise<Response> | undefined) {
  return mockApi((path, options) => {
    const custom = override?.(path, options); if (custom) return custom
    if (path === '/api/auth/me') return ok({ user: admin })
    if (path === '/api/admin/dashboard') return ok({ totalMovies: 7, activeShows: 11, bookingsToday: 3, capturedTodayPaise: 12345 })
    if (path === '/api/admin/movies') return ok(page([movie, { ...movie, id: 'disabled_movie_unit', title: 'Disabled historical movie', isActive: false }]))
    if (path === '/api/admin/shows') return ok(page([show]))
    if (path === '/api/admin/bookings') return ok(page([]))
    if (path === '/api/admin/payments') return ok(page([{ ...payment, status: 'REFUND_PENDING', createdAt: '2026-10-07T00:00:00Z', booking: { id: ids.booking, status: 'CANCELLED', user: { id: ids.user, name: user.name } }, refunds: [] }]))
  })
}
it('denies admin UI based on current backend user, not a stored role claim', async () => {
  visit('/admin'); const calls = mockApi(); render(<App />)
  expect(await screen.findByRole('heading', { name: 'Administrator access required' })).toBeVisible()
  expect(calls.some(call => call.path.startsWith('/api/admin'))).toBe(false)
})
it('approved dashboard cards use server counts and captured amount, not prototype metrics', async () => {
  visit('/admin'); adminApi(); render(<App />)
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible()
  expect(await screen.findByText('7')).toBeVisible(); expect(screen.getByText('11')).toBeVisible()
  expect(screen.getByText('₹123.45')).toBeVisible(); expect(screen.queryByText('₹84,200')).not.toBeInTheDocument()
  expect(screen.getByText('Daily totals follow UTC. Captured amounts are shown before refunds.')).toBeVisible()
})
it('admin movie table includes disabled historical records', async () => {
  visit('/admin/movies'); adminApi(); render(<App />)
  expect(await screen.findByRole('cell', { name: 'Disabled historical movie' })).toBeVisible()
  expect(screen.getByRole('cell', { name: 'Disabled' })).toBeVisible()
})
it('admin movie creation submits typed real catalog fields', async () => {
  visit('/admin/movies')
  const calls = adminApi((path, options) => path === '/api/admin/movies' && options.method === 'POST' ? ok({ movie }, 201) : undefined)
  render(<App />); await userEvent.click(await screen.findByRole('button', { name: 'Add Movie' }))
  await userEvent.type(screen.getByLabelText('Title'), 'New cinema')
  await userEvent.type(screen.getByLabelText('Description'), 'A new cinematic journey.')
  await userEvent.type(screen.getByLabelText('Duration (minutes)'), '120')
  fireEvent.change(screen.getByLabelText('Release date'), { target: { value: '2099-10-10' } })
  await userEvent.type(screen.getByLabelText('Language'), 'English')
  await userEvent.type(screen.getByLabelText('Genres (comma separated)'), 'Drama, Adventure')
  await userEvent.click(screen.getByRole('button', { name: 'Save movie' }))
  await waitFor(() => expect(calls.some(call => call.path === '/api/admin/movies' && call.options.method === 'POST')).toBe(true))
  const call = calls.find(call => call.path === '/api/admin/movies' && call.options.method === 'POST')!
  expect(JSON.parse(String(call.options.body))).toEqual({ title: 'New cinema', description: 'A new cinematic journey.', durationMinutes: 120,
    releaseDate: '2099-10-10', language: 'English', genres: ['Drama', 'Adventure'], posterUrl: null })
})
it('admin show creation uses physical layout types and timezone-aware per-type prices', async () => {
  visit('/admin/shows')
  const calls = adminApi((path, options) => path === '/api/admin/shows' && options.method === 'POST' ? ok({ show }, 201) : undefined)
  render(<App />); await userEvent.click(await screen.findByRole('button', { name: 'Add Show' }))
  await userEvent.selectOptions(await screen.findByLabelText('Movie'), ids.movie)
  await userEvent.selectOptions(await screen.findByLabelText('Theatre'), ids.theatre)
  await userEvent.selectOptions(await screen.findByLabelText('Screen'), ids.screen)
  fireEvent.change(screen.getByLabelText('Start time (UTC)'), { target: { value: '2099-10-10T14:00' } })
  await userEvent.type(await screen.findByLabelText('REGULAR price (paise)'), '12345')
  await userEvent.click(screen.getByRole('button', { name: 'Schedule show' }))
  await waitFor(() => expect(calls.some(call => call.path === '/api/admin/shows' && call.options.method === 'POST')).toBe(true))
  const call = calls.find(call => call.path === '/api/admin/shows' && call.options.method === 'POST')!
  expect(JSON.parse(String(call.options.body))).toEqual({ movieId: ids.movie, screenId: ids.screen,
    startsAt: '2099-10-10T14:00:00.000Z', prices: [{ seatType: 'REGULAR', pricePaise: 12345 }] })
})
it('admin payments show durable refund state without claiming success', async () => {
  visit('/admin/payments'); adminApi(); render(<App />)
  expect(await screen.findByText('REFUND PENDING')).toBeVisible()
  expect(screen.getByText('CANCELLED')).toBeVisible()
  expect(screen.getByText('Retry outstanding refunds. Completion depends on confirmation from the payment provider.')).toBeVisible()
})
it('admin distinguishes historical resolved compensation from an outstanding obligation', async () => {
  visit('/admin/payments')
  adminApi(path => path === '/api/admin/payments' ? ok(page([{ ...payment, status: 'REFUNDED', createdAt: '2026-10-07T00:00:00Z',
    reconciliation: { reason: 'BOOKING_CANCELLED', compensationRequired: true, resolvedAt: '2026-10-07T01:00:00Z' },
    booking: { id: ids.booking, status: 'CANCELLED', user: { id: ids.user, name: user.name } }, refunds: [] }])) : undefined)
  render(<App />); await screen.findByRole('cell', { name: 'REFUNDED' })
  expect(screen.queryByText('Compensation required')).not.toBeInTheDocument()
})
