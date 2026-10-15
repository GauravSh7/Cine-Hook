import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { DiscoveryLoading } from '../src/components/DiscoveryLoading'

it('shows only a compact spinner and the current discovery status', () => {
  render(<DiscoveryLoading status="Detecting your location…" />)
  const status = screen.getByRole('status')
  expect(status).toHaveTextContent('Detecting your location…')
  expect(status.querySelector('.discovery-loading-spinner')).toHaveAttribute('aria-hidden', 'true')
  expect(status.querySelectorAll('span')).toHaveLength(2)
})
