import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { CityProvider } from '../src/app/CityProvider'
import { useCity } from '../src/app/city-context'
import { LocationDialog } from '../src/components/LocationDialog'
import { mockApi, ok, page, timestamps } from './fixtures'

const cities = [
  { id: 'delhi', name: 'New Delhi', state: 'Delhi', countryCode: 'IN', ...timestamps },
  { id: 'mumbai', name: 'Mumbai', state: 'Maharashtra', countryCode: 'IN', ...timestamps },
  { id: 'bengaluru', name: 'Bengaluru', state: 'Karnataka', countryCode: 'IN', ...timestamps },
]
const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation')
afterEach(() => {
  sessionStorage.clear()
  if (originalGeolocation) Object.defineProperty(navigator, 'geolocation', originalGeolocation)
  else Reflect.deleteProperty(navigator, 'geolocation')
})
function setup(available = cities) {
  mockApi((path, _options, url) => {
    if (path !== '/api/cities') return undefined
    const search = url.searchParams.get('search')?.toLowerCase() ?? '', state = url.searchParams.get('state')?.toLowerCase() ?? '', limit = Number(url.searchParams.get('limit') ?? 20)
    const filtered = available.filter(item => (!state || item.state.toLowerCase() === state) && (!search || `${item.name} ${item.state}`.toLowerCase().includes(search)))
    return ok({ ...page(filtered.slice(0, limit)), limit })
  })
  return render(<CityProvider><LocationDialog onClose={() => {}} /></CityProvider>)
}
function position(latitude: number, longitude: number, accuracy = 20) {
  return { coords: { latitude, longitude, accuracy }, timestamp: Date.now() } as GeolocationPosition
}
function geolocation() {
  let success!: PositionCallback, failure!: PositionErrorCallback
  const getCurrentPosition = vi.fn((accept: PositionCallback, reject: PositionErrorCallback) => { success = accept; failure = reject })
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
  return { getCurrentPosition, success: (lat: number, lon: number, accuracy = 20) => act(() => success(position(lat, lon, accuracy))), failure: (code: number) => act(() => failure({ code } as GeolocationPositionError)) }
}

it('keeps the initial city list to five popular choices and reveals other supported cities by search', async () => {
  const available = [
    { id: 'delhi', name: 'New Delhi', state: 'Delhi', countryCode: 'IN', ...timestamps },
    { id: 'mumbai', name: 'Mumbai', state: 'Maharashtra', countryCode: 'IN', ...timestamps },
    { id: 'bengaluru', name: 'Bengaluru', state: 'Karnataka', countryCode: 'IN', ...timestamps },
    { id: 'hyderabad', name: 'Hyderabad', state: 'Telangana', countryCode: 'IN', ...timestamps },
    { id: 'chennai', name: 'Chennai', state: 'Tamil Nadu', countryCode: 'IN', ...timestamps },
    { id: 'greater-noida', name: 'Greater Noida', state: 'Uttar Pradesh', countryCode: 'IN', ...timestamps },
    { id: 'muzaffarnagar', name: 'Muzaffarnagar', state: 'Uttar Pradesh', countryCode: 'IN', ...timestamps },
  ]
  setup(available)
  expect(await screen.findByRole('radio', { name: 'Chennai' })).toBeVisible()
  expect(screen.getAllByRole('radio')).toHaveLength(6)
  expect(screen.queryByRole('radio', { name: 'Greater Noida' })).not.toBeInTheDocument()
  await userEvent.type(screen.getByRole('searchbox'), 'Muzaffarnagar')
  expect(await screen.findByRole('radio', { name: 'Muzaffarnagar' })).toBeVisible()
  expect(screen.queryByRole('radio', { name: 'Mumbai' })).not.toBeInTheDocument()
})

it('filters supported city choices by state and combines city search with that state', async () => {
  setup()
  await screen.findByRole('radio', { name: 'Mumbai' })
  await userEvent.selectOptions(screen.getByLabelText('State'), 'Maharashtra')
  expect(screen.getByRole('radio', { name: 'Mumbai' })).toBeVisible()
  expect(screen.queryByRole('radio', { name: 'New Delhi' })).not.toBeInTheDocument()
  await userEvent.type(screen.getByRole('searchbox'), 'Bengaluru')
  expect(screen.queryByRole('radio', { name: 'Bengaluru' })).not.toBeInTheDocument()
  expect(await screen.findByText('No matching cities.')).toBeVisible()
})

it('requests location only when clicked and waits for Save before persisting the nearby supported city', async () => {
  const geo = geolocation(); sessionStorage.setItem('cinehook.city', 'delhi'); setup()
  await screen.findByRole('radio', { name: 'Mumbai' })
  expect(geo.getCurrentPosition).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
  geo.success(19.076, 72.8777)
  expect(await screen.findByRole('radio', { name: 'Mumbai' })).toBeChecked()
  expect(sessionStorage.getItem('cinehook.city')).toBe('delhi')
  await userEvent.click(screen.getByRole('button', { name: 'Save location' }))
  expect(sessionStorage.getItem('cinehook.city')).toBe('mumbai')
})

it('ignores a delayed location response after a manual city choice', async () => {
  const geo = geolocation(); setup(); await screen.findByRole('radio', { name: 'Mumbai' })
  await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
  await userEvent.click(screen.getByRole('radio', { name: 'Bengaluru' }))
  geo.success(19.076, 72.8777)
  expect(screen.getByRole('radio', { name: 'Bengaluru' })).toBeChecked()
})

it('ignores a delayed location response when the user reaffirms the already selected city', async () => {
  const geo = geolocation(); sessionStorage.setItem('cinehook.city', 'delhi'); setup()
  await screen.findByRole('radio', { name: 'New Delhi' })
  await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
  await userEvent.click(screen.getByRole('radio', { name: 'New Delhi' }))
  geo.success(19.076, 72.8777)
  expect(screen.getByRole('radio', { name: 'New Delhi' })).toBeChecked()
})

it('keeps manual selection when browser coordinates are too imprecise to choose a nearby city', async () => {
  const geo = geolocation(); setup(); await screen.findByRole('radio', { name: 'Mumbai' })
  await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
  geo.success(19.076, 72.8777, 200000)
  expect(screen.getByRole('radio', { name: 'All cities' })).toBeChecked()
  expect(screen.getByRole('status')).toHaveTextContent(/choose.*city/i)
})

it.each([['denied', 1], ['unavailable', 2], ['timed out', 3]])('keeps manual city selection usable when location is %s', async (_label, code) => {
  const geo = geolocation(); setup(); await screen.findByRole('radio', { name: 'Mumbai' })
  await userEvent.click(screen.getByRole('radio', { name: 'Bengaluru' }))
  await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
  geo.failure(code)
  expect(screen.getByRole('status')).toHaveTextContent(/choose.*city/i)
  expect(screen.getByRole('radio', { name: 'Bengaluru' })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Save location' })).toBeEnabled()
})

it.each([[51.5074, -0.1278], [Number.NaN, 72], [90.1, 72]])('does not choose a city for distant or invalid coordinates %s, %s', async (lat, lon) => {
  const geo = geolocation(); setup(); await screen.findByRole('radio', { name: 'Mumbai' })
  await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
  geo.success(lat, lon)
  expect(screen.getByRole('radio', { name: 'All cities' })).toBeChecked()
  expect(screen.getByRole('status')).toHaveTextContent(/choose.*city/i)
})

it('does not invent a city when the returned supported cities have no known coordinates', async () => {
  const geo = geolocation(); setup([{ ...cities[0], id: 'unknown', name: 'Unmapped City' }]); await userEvent.type(screen.getByRole('searchbox'), 'Unmapped City'); await screen.findByRole('radio', { name: 'Unmapped City' })
  await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
  geo.success(28.6139, 77.209)
  expect(screen.getByRole('radio', { name: 'All cities' })).toBeChecked()
  expect(screen.getByRole('status')).toHaveTextContent(/choose.*city/i)
})

it('discards geolocation callbacks after the location control unmounts', async () => {
  const geo = geolocation(); const view = setup(); await screen.findByRole('radio', { name: 'Mumbai' })
  await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
  view.unmount(); geo.success(19.076, 72.8777)
  expect(sessionStorage.getItem('cinehook.city')).toBeNull()
})

it('refuses to persist a city outside the supported city list', async () => {
  mockApi(path => path === '/api/cities' ? ok(page(cities)) : undefined)
  function Choice() { const city = useCity(); return <><p>{city.cityId || 'All cities'}</p><button disabled={city.loading} onClick={() => city.choose('unknown')}>Unknown city</button></> }
  render(<CityProvider><Choice /></CityProvider>)
  await userEvent.click(await screen.findByRole('button', { name: 'Unknown city' }))
  expect(sessionStorage.getItem('cinehook.city')).toBeNull()
})

it('searches beyond the first city page and remembers the selected city', async () => {
  const manyCities = Array.from({ length: 120 }, (_, index) => ({ id: `city-${index}`, name: `Town ${index}`, state: 'Uttar Pradesh', countryCode: 'IN', ...timestamps }))
  manyCities.push({ id: 'muzaffarnagar', name: 'Muzaffarnagar', state: 'Uttar Pradesh', countryCode: 'IN', ...timestamps })
  setup(manyCities)
  const input = await screen.findByRole('searchbox')
  await userEvent.type(input, 'Muzaffarnagar')
  const choice = await screen.findByRole('radio', { name: 'Muzaffarnagar' })
  await userEvent.click(choice)
  await userEvent.click(screen.getByRole('button', { name: 'Save location' }))
  expect(sessionStorage.getItem('cinehook.city')).toBe('muzaffarnagar')
  expect(JSON.parse(sessionStorage.getItem('cinehook.city-record') ?? 'null')).toMatchObject({ name: 'Muzaffarnagar', state: 'Uttar Pradesh' })
})
