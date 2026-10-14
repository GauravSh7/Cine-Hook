import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { CategoryFeaturedCarousel } from '../src/components/CategoryFeaturedCarousel'
import { categorySlides } from '../src/components/category-carousel-data'
import type { DemoListing } from '../src/api/demo-catalog'
import { eventDetail } from './event-fixtures'
import { CategoryPage } from '../src/pages/CategoryPage'
import { CityContext } from '../src/app/city-context'
import { city, mockApi, ok, page } from './fixtures'

const listing: DemoListing = { id:'story', slug:'story', kind:'STREAM', title:'Night Train — DEMO', description:'', category:'Drama', cityName:null, venueName:null, startsAt:null, durationMinutes:90, imageUrl:'', imageAttribution:'', isDemo:true, bookingAvailable:false }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
function view() { return render(<MemoryRouter><CategoryFeaturedCarousel category="stream" title="Stories" slides={categorySlides('stream', [listing, {...listing,id:'second',title:'Ocean Road'}], [], '', Date.now())}/></MemoryRouter>) }
it('advances at five seconds, wraps and keeps stream actions exploratory', () => {
  vi.useFakeTimers(); view()
  const hero=screen.getByRole('region',{name:'Featured stream'})
  expect(within(hero).queryByRole('button',{name:/pause|start automatic/i})).not.toBeInTheDocument()
  expect(within(hero).getByRole('link',{name:'Explore'})).toHaveAttribute('href','/stream/story')
  act(() => vi.advanceTimersByTime(5000))
  expect(within(hero).getByRole('heading',{name:'Ocean Road'})).toBeVisible()
  expect(within(hero).getByRole('link',{name:'Explore'})).toHaveAttribute('href','/stream/second')
  act(() => vi.advanceTimersByTime(5000))
  expect(within(hero).getByRole('heading',{name:'Night Train'})).toBeVisible()
  expect(within(hero).queryByRole('link',{name:'Book Now'})).not.toBeInTheDocument()
})
it('pauses for pointer, focus and hidden tabs and clears timers on unmount', () => {
  vi.useFakeTimers(); const result=view(), hero=screen.getByRole('region',{name:'Featured stream'})
  fireEvent.mouseEnter(hero); act(() => vi.advanceTimersByTime(10000))
  expect(within(hero).getByRole('heading',{name:'Night Train'})).toBeVisible()
  fireEvent.mouseLeave(hero); fireEvent.focus(within(hero).getByRole('link',{name:'Explore'})); act(() => vi.advanceTimersByTime(10000))
  expect(within(hero).getByRole('heading',{name:'Night Train'})).toBeVisible()
  fireEvent.blur(within(hero).getByRole('link',{name:'Explore'}))
  const hidden=vi.spyOn(document,'hidden','get').mockReturnValue(true)
  fireEvent(document,new Event('visibilitychange')); act(() => vi.advanceTimersByTime(10000))
  expect(within(hero).getByRole('heading',{name:'Night Train'})).toBeVisible()
  hidden.mockReturnValue(false); fireEvent(document,new Event('visibilitychange')); act(() => vi.advanceTimersByTime(5000))
  expect(within(hero).getByRole('heading',{name:'Ocean Road'})).toBeVisible()
  result.unmount(); expect(vi.getTimerCount()).toBe(0)
})
it('respects reduced motion while leaving manual navigation available', () => {
  vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}))
  vi.useFakeTimers(); view(); const hero=screen.getByRole('region',{name:'Featured stream'})
  act(() => vi.advanceTimersByTime(10000)); expect(within(hero).getByRole('heading',{name:'Night Train'})).toBeVisible()
  fireEvent.click(within(hero).getByRole('button',{name:'Next featured experience'}))
  expect(within(hero).getByRole('heading',{name:'Ocean Road'})).toBeVisible()
})
it('features only matching inventory with a future scheduled session in the selected city', () => {
  const cancelled={...eventDetail,id:'cancelled',sessions:eventDetail.sessions.map(session=>({...session,status:'CANCELLED' as const}))}
  const otherKind={...eventDetail,id:'sport',kind:'SPORTS' as const}
  const slides=categorySlides('events',[],[eventDetail,cancelled,otherKind],eventDetail.sessions[0]!.venue.cityId,Date.now())
  expect(slides.map(slide=>slide.href)).toEqual([`/events/bookable/${eventDetail.id}`])
  expect(categorySlides('events',[],[eventDetail],'another-city',Date.now())).toEqual([])
  expect(categorySlides('stream',[listing], [eventDetail], '',Date.now()).map(slide=>slide.action)).toEqual(['Explore'])
})
it('uses the city-filtered bookable response for the hero without a second inventory request', async () => {
  const calls=mockApi((path,_options,url)=>{
    if(path === '/api/events') {
      expect(url.searchParams.get('cityId')).toBe(city.id)
      expect(url.searchParams.get('kind')).toBe('EVENTS')
      return ok(page([eventDetail]))
    }
  })
  render(<MemoryRouter><CityContext.Provider value={{cityId:city.id,cities:[city],selectedCity:city,choose:()=>{},chooseCity:()=>{},retry:()=>{}}}><CategoryPage category="events"/></CityContext.Provider></MemoryRouter>)
  const hero=screen.getByRole('region',{name:'Featured events'})
  expect(await within(hero).findByRole('link',{name:'Book Now'})).toHaveAttribute('href',`/events/bookable/${eventDetail.id}`)
  expect(calls.filter(call=>call.path === '/api/events')).toHaveLength(1)
})
