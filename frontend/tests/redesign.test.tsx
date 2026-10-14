import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import App from '../src/App'
import { Poster } from '../src/components/MovieCard'
import { ids, mockApi, movie, ok, page, show } from './fixtures'

it('keeps all six categories together, removes header search and limits the approved footer to home', async () => {
  mockApi(); render(<App />)
  await screen.findByRole('heading', { level: 1, name: movie.title })
  const header = screen.getByRole('banner')
  expect(within(header).queryByRole('search')).not.toBeInTheDocument()
  expect(within(screen.getByRole('navigation', { name: 'Categories' })).getAllByRole('link').map(a => a.textContent)).toEqual(['Movies', 'Stream', 'Events', 'Sports', 'Activities', 'Offers'])
  const footer = screen.getByRole('contentinfo')
  expect(footer.querySelectorAll('section')).toHaveLength(3)
  expect(within(footer).getByRole('link', { name: 'About Developer' })).toHaveAttribute('href', 'https://portfolio-gold-eight-71.vercel.app/#')
  expect(footer).not.toHaveTextContent(/sample screenings|not public cinema listings/i)
  await userEvent.click(screen.getAllByRole('link', { name: 'Book Now' })[0]!)
  await screen.findByRole('heading', { name: 'Select date' })
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
})

it.each([`/shows/${ids.show}/seats`, `/bookings/${ids.booking}/checkout`, `/bookings/${ids.booking}`])('uses a focused shell for %s', async path => {
  sessionStorage.setItem('cinehook.access-token', 'unit-access-token'); window.history.replaceState({}, '', path)
  mockApi(); render(<App />)
  await screen.findByRole('heading', { level: 1 })
  expect(screen.queryByRole('navigation', { name: 'Categories' })).not.toBeInTheDocument()
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /back/i })).toBeVisible()
})

it('clicking the same-home logo explicitly scrolls to the top', async () => {
  mockApi(); render(<App />); await screen.findByRole('heading', { level: 1, name: movie.title })
  const scroll = vi.mocked(window.scrollTo); scroll.mockClear()
  await userEvent.click(screen.getByRole('link', { name: 'CineHook' }))
  expect(scroll).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'smooth' })
})

it('recovers poster rendering when its source changes after a failed image', () => {
  const { rerender } = render(<MemoryRouter><Poster movie={{ ...movie, posterUrl: '/demo-art/one.svg' }} /></MemoryRouter>)
  fireEvent.error(screen.getByRole('img'))
  rerender(<MemoryRouter><Poster movie={{ ...movie, id: 'another', posterUrl: '/demo-art/two.svg' }} /></MemoryRouter>)
  expect(screen.getByRole('img')).toHaveAttribute('src', '/demo-art/two.svg')
})

it('disables past and cancelled direct-link shows even when physical seats appear available', async () => {
  window.history.replaceState({}, '', `/shows/${ids.show}/seats`)
  mockApi(path => path === `/api/shows/${ids.show}` ? ok({ show: { ...show, startsAt: '2020-01-01T00:00:00Z' } }) : undefined)
  render(<App />)
  expect(await screen.findByRole('button', { name: /A1.*available/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent(/no longer available/i)
})

it('keeps every independently loaded date available after selecting a date and sends an IST localDate', async () => {
  window.history.replaceState({}, '', `/movies/${ids.movie}`)
  const queries: URL[] = []
  mockApi((path, _options, url) => {
    if (path.endsWith('/show-dates')) return ok({ dates: ['2099-10-10', '2099-10-11', '2099-10-12', '2099-10-13', '2099-10-14', '2099-10-15'], timeZone: 'Asia/Kolkata' })
    if (path === '/api/shows') { queries.push(url); return ok(page([show])) }
  })
  render(<App />)
  const dates = await screen.findByRole('group', { name: 'Show dates in IST' })
  await userEvent.click(within(dates).getByRole('button', { name: /10 Oct/i }))
  await waitFor(() => expect(queries.at(-1)?.searchParams.get('localDate')).toBe('2099-10-10'))
  expect(within(dates).getByRole('button', { name: /15 Oct/i })).toBeVisible()
  expect(queries.at(-1)?.searchParams.has('date')).toBe(false)
})

it('waits for the persisted city to resolve instead of silently fetching all-city listings', async () => {
  sessionStorage.setItem('cinehook.city', ids.city)
  let release!: (value: Response) => void
  const urls: URL[] = []
  mockApi((path, _options, url) => { if (path === '/api/cities') return new Promise(resolve => { release = resolve }); if (path === '/api/movies') urls.push(url) })
  render(<App />)
  await act(async () => { await Promise.resolve() })
  expect(urls).toHaveLength(0)
  const { city } = await import('./fixtures')
  await act(async () => release(ok(page([city]))))
  await waitFor(() => expect(urls.some(url => url.searchParams.get('cityId') === ids.city)).toBe(true))
})
