import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { catalogApi } from '../api/catalog'
import type { City } from '../api/types'
import { CityContext } from './city-context'
import { useAsync } from './use-async'

export function CityProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState(() => { try { return sessionStorage.getItem('cinehook.city') ?? '' } catch { return '' } })
  const [savedRecord, setSavedRecord] = useState<City | null>(() => {
    try { const value = JSON.parse(sessionStorage.getItem('cinehook.city-record') ?? 'null') as City | null; return value && value.id === sessionStorage.getItem('cinehook.city') ? value : null } catch { return null }
  })
  const load = useCallback((signal: AbortSignal) => catalogApi.cities({ limit: 100 }, signal), [])
  const resource = useAsync('cities', load)
  const cities = useMemo(() => resource.data?.items ?? [], [resource.data])
  const selectedCity = savedRecord ?? cities.find(city => city.id === saved) ?? null
  const cityId = selectedCity?.id ?? ''
  const chooseCity = useCallback((next: City | null) => {
    setSaved(next?.id ?? ''); setSavedRecord(next)
    try { sessionStorage.setItem('cinehook.city', next?.id ?? ''); if (next) sessionStorage.setItem('cinehook.city-record', JSON.stringify(next)); else sessionStorage.removeItem('cinehook.city-record') } catch { /* Optional preference only. */ }
  }, [])
  const choose = useCallback((id: string) => {
    if (id === '') { chooseCity(null); return }
    const match = cities.find(city => city.id === id)
    if (match) chooseCity(match)
  }, [cities, chooseCity])
  return <CityContext.Provider value={{ cities, cityId, selectedCity, loading: resource.loading, choose, chooseCity, error: resource.error, retry: resource.reload }}>{children}</CityContext.Provider>
}
