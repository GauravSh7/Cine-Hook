import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { MovieCard } from '../src/components/MovieCard'
import { movie } from './fixtures'

it('sends released movies to real show selection with a Book Now action', () => {
  render(<MemoryRouter><MovieCard movie={{ ...movie, bookingAvailability: { cityId: null, hasShows: false } }} /></MemoryRouter>)
  expect(screen.getByRole('link', { name: 'Book Now' })).toHaveAttribute('href', `/movies/${movie.id}`)
})

it('keeps unreleased titles in the Coming Soon action state', () => {
  render(<MemoryRouter><MovieCard movie={{ ...movie, releaseDate: '2099-12-31T00:00:00.000Z' }} /></MemoryRouter>)
  expect(screen.getByRole('link', { name: 'Coming Soon' })).toHaveAttribute('href', `/movies/${movie.id}`)
})
