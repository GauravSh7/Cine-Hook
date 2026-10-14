import { useEffect } from 'react'
import { useLocation } from 'react-router'

export function NavigationEffects() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }) }, [pathname])
  return null
}
