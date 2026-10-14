import type { City } from '../api/types'

// Approximate city centres. Match the full identity, never guess by a partial name.
const centres: Record<string, readonly [number, number]> = {
  'IN|Delhi|New Delhi': [28.6139, 77.209],
  'IN|Maharashtra|Mumbai': [19.076, 72.8777],
  'IN|Karnataka|Bengaluru': [12.9716, 77.5946],
}

export function nearestSupportedCity(cities: City[], latitude: number, longitude: number): City | undefined {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined
  const radians = (degrees: number) => degrees * Math.PI / 180
  let nearest: City | undefined, minimumKm = 60
  for (const city of cities) {
    const centre = centres[`${city.countryCode}|${city.state}|${city.name}`]
    if (!centre) continue
    const a = Math.sin(radians(centre[0] - latitude) / 2) ** 2 + Math.cos(radians(latitude)) * Math.cos(radians(centre[0])) * Math.sin(radians(centre[1] - longitude) / 2) ** 2
    const distanceKm = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)))
    if (distanceKm <= minimumKm) { minimumKm = distanceKm; nearest = city }
  }
  return nearest
}
