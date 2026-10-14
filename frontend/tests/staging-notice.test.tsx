import { afterEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { CatalogueNotice } from '../src/components/CatalogueNotice'

afterEach(() => vi.restoreAllMocks())
it('labels staging inventory and disabled payments from the real API response', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true, data: { mode: 'staging', newPaymentsAllowed: false } }))
  render(<CatalogueNotice />)
  expect(await screen.findByRole('note')).toHaveTextContent('Venues and sessions are fictional. Payments are disabled.')
})
it('does not add a staging label to normal deployments', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true, data: { mode: 'standard', newPaymentsAllowed: true } }))
  render(<CatalogueNotice />)
  await waitFor(() => expect(fetcher).toHaveBeenCalled())
  expect(screen.queryByRole('note')).not.toBeInTheDocument()
})
