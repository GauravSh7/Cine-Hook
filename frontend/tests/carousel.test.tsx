import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { FeaturedCarousel } from '../src/components/FeaturedCarousel'
import { movie } from './fixtures'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
function setup() {
  vi.useFakeTimers()
  return render(<MemoryRouter><FeaturedCarousel movies={[movie, { ...movie, id: 'second', title: 'Arrival' }]} /></MemoryRouter>)
}
it('auto-advances at five seconds, loops and keeps the active Book Now destination correct without pause controls', () => {
  setup(); const hero = screen.getByRole('region', { name: 'Featured movies' })
  expect(within(hero).queryByRole('button', { name: /pause|start automatic/i })).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(4999))
  expect(within(hero).getByRole('heading', { name: movie.title })).toBeVisible()
  act(() => vi.advanceTimersByTime(1))
  expect(within(hero).getByRole('heading', { name: 'Arrival' })).toBeVisible()
  expect(within(hero).getByRole('link', { name: 'Book Now' })).toHaveAttribute('href', '/movies/second')
  act(() => vi.advanceTimersByTime(5000))
  expect(within(hero).getByRole('heading', { name: movie.title })).toBeVisible()
  expect(within(hero).getByRole('link', { name: 'Book Now' })).toHaveAttribute('href', `/movies/${movie.id}`)
})
it('features only artwork, title and booking action with manual navigation', () => {
  setup()
  const hero = screen.getByRole('region', { name: 'Featured movies' })
  expect(within(hero).queryByText(movie.description)).not.toBeInTheDocument()
  fireEvent.click(within(hero).getByRole('button', { name: 'Next featured movie' }))
  expect(within(hero).getByRole('heading', { name: 'Arrival' })).toBeVisible()
  expect(within(hero).getByRole('link', { name: 'Book Now' })).toHaveAttribute('href', '/movies/second')
  expect(within(hero).queryByRole('button', { name: /pause|start automatic/i })).not.toBeInTheDocument()
  fireEvent.click(within(hero).getByRole('button', { name: 'Previous featured movie' }))
  expect(within(hero).getByRole('heading', { name: movie.title })).toBeVisible()
})
it('pauses while focused or hidden, resumes afterward and cleans up its timer', () => {
  const view = setup(); const hero = screen.getByRole('region', { name: 'Featured movies' })
  act(() => vi.advanceTimersByTime(6500))
  expect(within(hero).getByRole('heading', { name: 'Arrival' })).toBeVisible()
  const link = within(hero).getByRole('link', { name: 'Book Now' })
  fireEvent.focus(link)
  act(() => vi.advanceTimersByTime(13000))
  expect(within(hero).getByRole('heading', { name: 'Arrival' })).toBeVisible()
  fireEvent.blur(link)
  act(() => vi.advanceTimersByTime(5000))
  expect(within(hero).getByRole('heading', { name: movie.title })).toBeVisible()
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange'))
  act(() => vi.advanceTimersByTime(15000))
  expect(within(hero).getByRole('heading', { name: movie.title })).toBeVisible()
  hidden.mockReturnValue(false); fireEvent(document, new Event('visibilitychange'))
  act(() => vi.advanceTimersByTime(5000))
  expect(within(hero).getByRole('heading', { name: 'Arrival' })).toBeVisible()
  view.unmount(); expect(vi.getTimerCount()).toBe(0)
})
it('respects reduced motion while keeping manual navigation available', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  setup(); const hero = screen.getByRole('region', { name: 'Featured movies' })
  vi.useFakeTimers(); act(() => vi.advanceTimersByTime(20000))
  expect(within(hero).getByRole('heading', { name: movie.title })).toBeVisible()
  expect(within(hero).queryByRole('button', { name: /pause|start automatic/i })).not.toBeInTheDocument()
  fireEvent.click(within(hero).getByRole('button', { name: 'Next featured movie' }))
  expect(within(hero).getByRole('heading', { name: 'Arrival' })).toBeVisible()
})
