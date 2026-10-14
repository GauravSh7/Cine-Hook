import { createContext, useContext } from 'react'
import type { City } from '../api/types'

export interface CityPreference { cityId: string; selectedCity: City | null; cities: City[]; loading?: boolean; error?: Error; choose(id: string): void; chooseCity(city: City | null): void; retry(): void }
export const CityContext = createContext<CityPreference | null>(null)
export function useCity() {
  const value = useContext(CityContext)
  if (!value) throw new Error('City provider missing.')
  return value
}
