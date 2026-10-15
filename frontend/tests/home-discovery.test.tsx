import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import App from '../src/App'
import { city, mockApi, ok, page } from './fixtures'

const oldGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation')
afterEach(() => {
  cleanup()
  if (oldGeolocation) Object.defineProperty(navigator, 'geolocation', oldGeolocation)
  else Reflect.deleteProperty(navigator, 'geolocation')
  sessionStorage.clear()
})

it('detects a nearby supported city automatically before loading its movie catalogue', async () => {
  sessionStorage.clear()
  window.history.replaceState({}, '', '/')
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition: (success: PositionCallback) => success({
      coords: { latitude: 28.4744, longitude: 77.504, accuracy: 100, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
      timestamp: Date.now(), toJSON: () => ({}),
    } as GeolocationPosition),
  } })
  const requestedCities: string[] = []
  const calls = mockApi((path, _options, url) => {
    if (path === '/api/cities') {
      requestedCities.push(url.searchParams.get('search') ?? '')
      return ok(page([city]))
    }
    return undefined
  })
  render(<App />)
  expect(await screen.findByRole('heading', { name: 'Find your next story.' })).toBeVisible()
  expect(requestedCities).toContain('Greater Noida')
  expect(sessionStorage.getItem('cinehook.city')).toBe(city.id)
  expect(calls.some(call => call.path === '/api/movies')).toBe(true)
})
