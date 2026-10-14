import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import App from '../src/App'
import { EventVenueMap } from '../src/components/EventVenueMap'
import { eventAvailability, eventSession, physicalSeats } from './event-fixtures'
import { ids, mockApi, ok, show } from './fixtures'

it.each(['football', 'cricket', 'basketball'])('surrounds the %s field with stadium lighting without changing seat selection', async sport => {
  const toggled: string[] = []
  const session = { ...eventSession, event: { ...eventSession.event, kind: 'SPORTS' as const, sport }, venue: { ...eventSession.venue, kind: 'STADIUM' as const, sections: eventSession.venue.sections.map((section, index) => ({ ...section, position: index ? 'SOUTH' : 'NORTH' })) } }
  const { container, rerender } = render(<EventVenueMap session={session} seats={eventAvailability.seats} selected={[physicalSeats[0]!.id]} disabled={false} onToggle={id => toggled.push(id)} />)
  expect(container.querySelector('.stadium-floodlights')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: new RegExp(`${sport} (field|court)`, 'i') })).toBeVisible()
  const seatRegion = screen.getByRole('region', { name: /Venue seat map/ })
  expect(within(seatRegion).getAllByRole('button')).toHaveLength(3)
  const selected = within(seatRegion).getByRole('button', { name: /Front rows.*A1 available.*₹950.00/ })
  expect(selected).toHaveAttribute('aria-pressed', 'true')
  expect(within(seatRegion).getByRole('button', { name: /Rear rows.*A4 booked.*₹400.00/ })).toBeDisabled()
  await userEvent.click(selected)
  expect(toggled).toEqual(['60000000-0000-4000-8000-000000000006'])
  rerender(<EventVenueMap session={session} seats={eventAvailability.seats} selected={[]} disabled onToggle={id => toggled.push(id)} />)
  expect(within(seatRegion).getAllByRole('button').every(button => button.hasAttribute('disabled'))).toBe(true)
})

it('provides a neutral court for an unknown sport and retains missing inventory as unavailable', () => {
  const session = { ...eventSession, event: { ...eventSession.event, kind: 'SPORTS' as const, sport: 'badminton' }, venue: { ...eventSession.venue, kind: 'ARENA' as const } }
  render(<EventVenueMap session={session} seats={[]} selected={[]} disabled={false} onToggle={() => {}} />)
  expect(screen.getByRole('img', { name: 'Court' })).toBeVisible()
  expect(within(screen.getByRole('region', { name: /Venue seat map/ })).getAllByRole('button')).toHaveLength(3)
  expect(screen.getByRole('button', { name: /Front rows.*A1 unavailable.*price unavailable/ })).toBeDisabled()
  expect(screen.queryByText(/illustration unavailable|persisted sections/)).not.toBeInTheDocument()
})

it.each([{ capacity: 60, variant: 'medium' }, { capacity: 240, variant: 'grand' }])('uses real capacity $capacity for cinema atmosphere without adding seats', async ({ capacity, variant }) => {
  window.history.replaceState({}, '', `/shows/${ids.show}/seats`)
  mockApi(path => path === `/api/shows/${ids.show}` ? ok({ show: { ...show, screen: { ...show.screen, capacity } } }) : undefined)
  const { container } = render(<App />)
  const seat = await screen.findByRole('button', { name: /A1 available regular ₹123.45/i })
  expect(container.querySelector('.cinema-auditorium')).toHaveAttribute('data-hall-variant', variant)
  expect(screen.getByRole('img', { name: 'Cinema screen' })).toBeVisible()
  const seatRegion = screen.getByRole('region', { name: /Seat map, horizontally scrollable/ })
  expect(within(seatRegion).getAllByRole('button')).toHaveLength(3)
  expect(screen.getByRole('button', { name: /A2 unavailable regular/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: /A3 booked regular/ })).toBeDisabled()
  await userEvent.click(seat)
  expect(seat).toHaveAttribute('aria-pressed', 'true')
  expect(sessionStorage.getItem(`cinehook.seats.${ids.show}`)).toBe('["20000000-0000-4000-8000-000000000001"]')
  expect(screen.getByText('₹123.45')).toBeVisible()
})
