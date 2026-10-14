import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import App from '../src/App'
import { failure, ids, mockApi, movie, ok, page, seats } from './fixtures'

it('loads real catalog into the approved featured hero and movie cards', async () => {
  const calls = mockApi(); render(<App />)
  expect(await screen.findByRole('heading', { level: 1, name: movie.title })).toBeVisible()
  expect(screen.getByRole('region', { name: 'Featured movies' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Book Now' })).toHaveAttribute('href', `/movies/${movie.id}`)
  expect(calls.some(call => call.path === '/api/movies')).toBe(true)
  expect(screen.queryByText('Dune: Part Two')).not.toBeInTheDocument()
})
it('uses curated featured data instead of advertising an alphabetical upcoming release for booking', async () => {
  mockApi(path => path === '/api/movies' ? ok(page([{ ...movie, id: 'upcoming-unit', title: 'A future release', releaseDate: '2099-12-01', collections: [], bookingAvailability: { cityId: null, hasShows: false } }, movie])) : undefined)
  render(<App />)
  expect(await screen.findByRole('heading', { level: 1, name: 'Interstellar' })).toBeVisible()
})
it('starts a new movie page at the top instead of preserving an earlier checkout scroll', async () => {
  const scroll = vi.fn(); vi.stubGlobal('scrollTo', scroll); mockApi(); render(<App />)
  await screen.findByRole('heading', { level: 1, name: movie.title }); scroll.mockClear()
  await userEvent.click(screen.getAllByRole('link', { name: 'Book Now' })[0]!)
  await screen.findByRole('heading', { level: 1, name: movie.title })
  expect(scroll).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' })
})
it('renders a truthful empty catalog instead of prototype movies', async () => {
  mockApi(path => path === '/api/movies' ? ok(page([])) : undefined); render(<App />)
  expect(await screen.findByRole('heading', { name: 'No movies available' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: movie.title })).not.toBeInTheDocument()
})
it('offers retry after a catalog outage and loads recovered data', async () => {
  let down = true
  mockApi(path => path === '/api/movies' && down ? failure(503, 'DATABASE_UNAVAILABLE', 'Catalog temporarily unavailable.') : undefined)
  render(<App />); expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i)
  down = false; await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('heading', { level: 1, name: movie.title })).toBeVisible()
})
it('shows physical seat states and submits only selected available IDs for the server quote', async () => {
  sessionStorage.setItem('cinehook.access-token', 'unit-access-token')
  window.history.replaceState({}, '', `/shows/${ids.show}/seats`)
  const calls = mockApi(); render(<App />)
  const available = await screen.findByRole('button', { name: /A1.*available/i })
  expect(screen.getByRole('button', { name: /A2.*unavailable/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /A3.*booked/i })).toBeDisabled()
  await userEvent.click(available); await userEvent.click(screen.getByRole('button', { name: /continue/i }))
  await waitFor(() => expect(window.location.pathname).toBe(`/bookings/${ids.booking}/checkout`))
  const call = calls.find(value => value.path === '/api/bookings' && value.options.method === 'POST')!
  expect(JSON.parse(String(call.options.body))).toEqual({ showId: ids.show, seatIds: [seats[0]!.id] })
  expect(await screen.findByRole('heading', { name: 'Checkout' })).toBeVisible()
})
