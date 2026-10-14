import { useCallback, useEffect, useRef, useState } from 'react'
import { catalogApi } from '../api/catalog'
import type { City } from '../api/types'
import { useCity } from '../app/city-context'
import { useAsync } from '../app/use-async'
import { nearestSupportedCity } from '../domain/location'
import { LocationPin } from './LocationPin'

const INDIAN_STATES_AND_UTS = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
]
const POPULAR_CITY_NAMES = ['New Delhi', 'Mumbai', 'Bengaluru', 'Hyderabad', 'Chennai']
const normalizeSearch = (value: string) => value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const SEARCH_CORRECTIONS: Record<string, string> = { muzaffarngar: 'Muzaffarnagar', muzafarnagar: 'Muzaffarnagar' }

function detectedArea(latitude:number,longitude:number):string|undefined {
  const point=[28.4744,77.5040],rad=(value:number)=>value*Math.PI/180
  const a=Math.sin(rad(point[0]-latitude)/2)**2+Math.cos(rad(latitude))*Math.cos(rad(point[0]))*Math.sin(rad(point[1]-longitude)/2)**2
  return 6371*2*Math.asin(Math.sqrt(Math.min(1,a)))<=18?'Greater Noida':undefined
}

export function LocationDialog({ onClose }: { onClose(): void }) {
  const city = useCity(), [search, setSearch] = useState(''), [searchTerm, setSearchTerm] = useState(''), [selection, setSelected] = useState<City | null | undefined>(undefined)
  const [state, setState] = useState(''), [locating, setLocating] = useState(false), [locationMessage, setLocationMessage] = useState('')
  const selected = selection === undefined ? city.cityId : selection?.id ?? ''
  useEffect(() => { const timer = window.setTimeout(() => setSearchTerm(search.trim()), 180); return () => window.clearTimeout(timer) }, [search])
  const correctedSearch = SEARCH_CORRECTIONS[normalizeSearch(searchTerm)] ?? searchTerm
  const loadCities = useCallback(async (signal: AbortSignal) => {
    if (correctedSearch || state) return catalogApi.cities({ limit: 100, search: correctedSearch || undefined, state: state || undefined }, signal)
    const results = await Promise.all(POPULAR_CITY_NAMES.map(async name => {
      const result = await catalogApi.cities({ limit: 10, search: name }, signal)
      return result.items.find(item => normalizeSearch(item.name) === normalizeSearch(name))
    }))
    return { items: results.filter((item): item is City => Boolean(item)), page: 1, limit: POPULAR_CITY_NAMES.length }
  }, [correctedSearch, state])
  const cityResults = useAsync(`city-search:${state}:${correctedSearch}`, loadCities)
  const matches = cityResults.data?.items ?? []
  const panel = useRef<HTMLElement>(null)
  const locationRequest = useRef({ version: 0 })
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const request = locationRequest.current
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
    return () => { request.version++; document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  const states = [...new Set([...INDIAN_STATES_AND_UTS, ...city.cities.map(item => item.state), ...(city.selectedCity ? [city.selectedCity.state] : [])])].sort((a, b) => a.localeCompare(b))
  const chosenRecord = selection === undefined ? city.selectedCity : selection
  const selectedMatches = searchTerm ? matches : matches.filter(item => POPULAR_CITY_NAMES.some(name => normalizeSearch(name) === normalizeSearch(item.name)))
  const visibleCities = [...new Map([...(chosenRecord && (!state || chosenRecord.state === state) ? [chosenRecord] : []), ...selectedMatches].map(item => [item.id, item])).values()].slice(0, searchTerm ? 100 : 5)
  const selectedRecord = chosenRecord ?? (selected ? city.cities.find(item => item.id === selected) ?? null : null)
  const cancelLocation = () => { locationRequest.current.version++; setLocating(false); setLocationMessage('') }
  const chooseManually = (next: City | null) => { cancelLocation(); setSelected(next); if (!next) { setState(''); setSearch(''); setSearchTerm('') } }
  const useLocation = () => {
    const request = ++locationRequest.current.version
    if (!navigator.geolocation) { setLocationMessage('Location is unavailable in this browser. Please choose your city.'); return }
    setLocating(true); setLocationMessage('Finding a nearby supported city…')
    const fail = (error?: GeolocationPositionError) => {
      if (request !== locationRequest.current.version) return
      setLocating(false)
      setLocationMessage(error?.code === 1 ? 'Location permission was denied. Please choose your city.' : error?.code === 3 ? 'Location took too long. Please choose your city or try again.' : 'Your location is unavailable. Please choose your city or try again.')
    }
    try {
      navigator.geolocation.getCurrentPosition(position => {
        if (request !== locationRequest.current.version) return
        if (!Number.isFinite(position.coords.accuracy) || position.coords.accuracy < 0 || position.coords.accuracy > 25000) {
          setLocating(false); setLocationMessage('Your location is too imprecise. Please choose your city.'); return
        }
        const nearby = nearestSupportedCity(city.cities, position.coords.latitude, position.coords.longitude)
        setLocating(false)
        if (!nearby) { setLocationMessage('No supported city was found nearby. Please choose your city.'); return }
        setState(nearby.state); setSearch(nearby.name); setSearchTerm(nearby.name); setSelected(nearby)
        const area=detectedArea(position.coords.latitude,position.coords.longitude)
        setLocationMessage(area ? `Your location appears to be near ${area}. ${nearby.name} is the nearest supported booking city. Save location to browse its shows.` : `Nearest supported booking city: ${nearby.name}. Save location to browse its shows.`)
      }, fail, { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 })
    } catch { fail() }
  }
  return <div className="dialog-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}><section className="panel location-dialog" role="dialog" aria-modal="true" aria-labelledby="location-title" ref={panel} onKeyDown={event => {
    if (event.key === 'Escape') onClose()
    if (event.key === 'Tab') {
      const targets = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])
      if (event.shiftKey && document.activeElement === targets[0]) { event.preventDefault(); targets.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === targets.at(-1)) { event.preventDefault(); targets[0]?.focus() }
    }
  }}><div className="flex items-center justify-between gap-4"><h2 id="location-title" className="text-xl font-semibold">Select your location</h2><button className="icon-button" aria-label="Close location" onClick={onClose}>×</button></div>
    <button className="secondary location-auto mt-5" disabled={city.loading || Boolean(city.error) || locating} onClick={useLocation}><LocationPin />{locating ? 'Finding your city…' : 'Use my location'}</button>
    {locationMessage && <p role="status" className="muted mt-3">{locationMessage}</p>}
    <label className="block mt-5">State<select className="input mt-2" value={state} disabled={city.loading || Boolean(city.error)} onChange={event => {
      const nextState = event.target.value
      cancelLocation(); setState(nextState)
      if (nextState && selectedRecord?.state !== nextState) setSelected(null)
    }}><option value="">All states</option>{states.map(item => <option value={item} key={item}>{item}</option>)}</select></label>
    <label className="block mt-5">Search cities<input className="input mt-2" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search for your city" /></label>
    {city.error && <div role="alert" className="mt-3"><p className="muted">Location preferences could not be loaded.</p><button className="secondary mt-2" onClick={city.retry}>Retry</button></div>}
    <fieldset className="mt-5"><legend className="muted text-sm mb-3">Choose a city</legend><div className="city-grid"><label className={`city-option ${selected === '' ? 'selected' : ''}`}><input type="radio" name="city" checked={selected === ''} onClick={cancelLocation} onChange={() => chooseManually(null)} /><LocationPin/>All cities</label>{visibleCities.map(item => <label className={`city-option ${selected === item.id ? 'selected' : ''}`} key={item.id}><input type="radio" name="city" checked={selected === item.id} onClick={cancelLocation} onChange={() => chooseManually(item)} /><LocationPin/>{item.name}</label>)}</div>{cityResults.loading && <p role="status" className="muted mt-3">Searching cities…</p>}{cityResults.error && <div role="alert" className="muted mt-3">Could not search cities. <button className="secondary" onClick={cityResults.reload}>Retry</button></div>}{!cityResults.loading && !cityResults.error && matches.length === 0 && <p className="muted mt-3">{searchTerm ? 'No matching cities.' : 'Search for a city to see more options.'}</p>}</fieldset>
    <button className="btn w-full mt-6" disabled={city.loading || Boolean(city.error) || (selected !== '' && !selectedRecord)} onClick={() => { cancelLocation(); city.chooseCity(selectedRecord); onClose() }}>Save location</button>
  </section></div>
}
