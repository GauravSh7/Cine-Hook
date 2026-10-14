import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import { CategoryPage } from '../src/pages/CategoryPage'
import { CityContext } from '../src/app/city-context'
import { city, failure, mockApi, ok, page } from './fixtures'

const listing = { id: 'demo-1', slug: 'demo-skyline-sessions', kind: 'EVENTS', title: 'Skyline Sessions — DEMO',
  description: 'Fictional acoustic evening on a rooftop.', category: 'Concerts', cityName: 'Mumbai', venueName: 'Demo Skyline Terrace',
  startsAt: '2099-10-12T13:00:00.000Z', durationMinutes: 90, imageUrl: '/demo-category-art/events.svg',
  imageAttribution: 'Original CineHook illustration. Fictional demo listing.', isDemo: true, bookingAvailable: false }
function view(category: 'stream' | 'events' | 'sports' | 'activities' = 'events') {
  return render(<MemoryRouter><CityContext.Provider value={{ cityId: '', cities: [city], selectedCity: null, choose: () => {}, chooseCity: () => {}, retry: () => {} }}><CategoryPage category={category}/></CityContext.Provider></MemoryRouter>)
}

it('shows a loading state while demo content is pending', async () => {
  let release!: (response: Response) => void
  mockApi(path => path === '/api/demo-catalog/events' ? new Promise(resolve => { release = resolve }) : undefined)
  view()
  expect(screen.getByRole('status')).toHaveTextContent(/loading experiences/i)
  await act(async () => release(ok(page([listing]))))
  expect(await screen.findByRole('heading', { name: 'Skyline Sessions',level:2 })).toBeVisible()
})

it('renders clean catalogue cards without internal attribution or unsupported payment controls', async () => {
  mockApi(path => path === '/api/demo-catalog/events' ? ok(page([listing])) : undefined)
  view()
  const card = (await screen.findByRole('heading', { name: 'Skyline Sessions',level:2 })).closest('article')!
  expect(card).toHaveTextContent('Mumbai')
  expect(card).toHaveTextContent('Skyline Terrace')
  expect(card).not.toHaveTextContent(/90 min|IST|2099|coming soon/i)
  expect(within(card).getByAltText(/banner/i).getAttribute('src')).not.toBe(listing.imageUrl)
  expect(card).not.toHaveTextContent(listing.imageAttribution)
  expect(within(card).getByText('Explore')).toBeVisible()
})

it('sends category and submitted search filters to the catalogue and can clear them', async () => {
  const queries: URL[] = [], sessionQueries: URL[] = []
  mockApi((path, _options, url) => {
    if (path === '/api/demo-catalog/events') { queries.push(url); return ok(page([listing])) }
    if (path === '/api/events') { sessionQueries.push(url); return ok(page([])) }
  })
  view()
  await screen.findByRole('heading', { name: 'Skyline Sessions',level:2 })
  expect(screen.getAllByRole('searchbox')).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Concerts' }))
  await waitFor(() => expect(queries.at(-1)?.searchParams.get('category')).toBe('Concerts'))
  await userEvent.type(screen.getByRole('searchbox'), 'Skyline')
  await userEvent.click(screen.getByRole('button', { name: /find listings/i }))
  await waitFor(() => expect(queries.at(-1)?.searchParams.get('search')).toBe('Skyline'))
  await waitFor(() => expect(sessionQueries.at(-1)?.searchParams.get('search')).toBe('Skyline'))
  await userEvent.click(screen.getByRole('button', { name: /clear filters/i }))
  await waitFor(() => expect(queries.at(-1)?.searchParams.has('category')).toBe(false))
  expect(queries.at(-1)?.searchParams.has('search')).toBe(false)
  await waitFor(() => expect(sessionQueries.at(-1)?.searchParams.has('search')).toBe(false))
})

it('reports empty filters without inventing content', async () => {
  mockApi(path => path === '/api/demo-catalog/events' ? ok(page([])) : undefined)
  view()
  expect(await screen.findByRole('heading', { name: 'No experiences found' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Skyline Sessions' })).not.toBeInTheDocument()
})

it('offers a working retry after a catalogue failure', async () => {
  let failed = true
  mockApi(path => path === '/api/demo-catalog/events' ? failed ? failure(503, 'SERVICE_UNAVAILABLE', 'internal') : ok(page([listing])) : undefined)
  view()
  expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i)
  failed = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('heading', { name: 'Skyline Sessions',level:2 })).toBeVisible()
})

it('does not show stale listings after the route kind changes', async () => {
  let release!: (response: Response) => void
  mockApi(path => path === '/api/demo-catalog/events' ? ok(page([listing])) : path === '/api/demo-catalog/sports' ? new Promise(resolve => { release = resolve }) : undefined)
  const { rerender } = view()
  await screen.findByRole('heading', { name: 'Skyline Sessions',level:2 })
  rerender(<MemoryRouter><CityContext.Provider value={{ cityId: '', cities: [city], selectedCity: null, choose: () => {}, chooseCity: () => {}, retry: () => {} }}><CategoryPage category="sports"/></CityContext.Provider></MemoryRouter>)
  expect(screen.queryByRole('heading', { name: 'Skyline Sessions' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(/loading experiences/i)
  await act(async () => release(ok(page([]))))
  expect(await screen.findByRole('heading', { name: 'No experiences found' })).toBeVisible()
})
