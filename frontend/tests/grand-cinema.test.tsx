import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from '../src/App'
import { ids, mockApi, ok, show } from './fixtures'

it('shows the physical tier boundaries in a 144-seat grand hall without altering inventory', async () => {
  const seats = Array.from({ length: 144 }, (_, index) => ({ id: `seat-${index}`, screenId: ids.screen, rowName: String.fromCharCode(65 + Math.floor(index / 12)), seatNumber: index % 12 + 1, seatType: index < 48 ? 'REGULAR' : index < 120 ? 'PREMIUM' : 'RECLINER', pricePaise: 30000, availability: index === 0 ? 'BOOKED' : index === 1 ? 'LOCKED' : 'AVAILABLE', remainingHoldMs: 0 }))
  window.history.replaceState({}, '', `/shows/${ids.show}/seats`)
  mockApi(path => path === `/api/shows/${ids.show}` ? ok({ show: { ...show, screen: { ...show.screen, capacity: 144, name: 'Grand Screen' } } }) : path.endsWith('/availability') ? ok({ showId: ids.show, seats }) : undefined)
  const { container } = render(<App />)
  await screen.findByRole('button', { name: /L12 available recliner/ })
  expect(container.querySelector('.cinema-auditorium')).toHaveAttribute('data-hall-variant', 'grand')
  expect(screen.getByText('Grand Screen')).toBeVisible()
  const map = screen.getByRole('region', { name: /Seat map, horizontally scrollable/ })
  expect(within(map).getAllByRole('button')).toHaveLength(144)
  expect(within(map).getAllByText(/REGULAR|PREMIUM|RECLINER/)).toHaveLength(3)
  expect(within(map).getByRole('button', { name: /A1 booked/ })).toBeDisabled()
  expect(within(map).getByRole('button', { name: /A2 unavailable/ })).toBeDisabled()
})
