import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { setAccessToken } from '../src/api/client'

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn()) // jsdom has no layout or browser scrolling.
  sessionStorage.clear()
  setAccessToken(null)
  window.history.replaceState({}, '', '/')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})
