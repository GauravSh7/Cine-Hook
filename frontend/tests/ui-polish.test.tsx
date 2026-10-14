import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import App from '../src/App'
import { BookingFacts } from '../src/components/BookingFacts'
import { city, failure, ids, mockApi, ok, page, summary } from './fixtures'

const listing = { id:'60000000-0000-4000-8000-000000000001', slug:'sample-comedy', kind:'EVENTS', title:'Laugh Lines — DEMO',
  description:'Fictional stand-up showcase with observational comedy.', category:'Comedy Shows', cityName:'Greater Noida', venueName:'Sample Spotlight Studio',
  startsAt:'2099-10-12T14:00:00.000Z', durationMinutes:75, imageUrl:'/demo-category-art/events.svg', imageAttribution:'Original CineHook illustration (CC0). Fictional sample event.', isDemo:true, bookingAvailable:false }
it('keeps the checkout booking summary clear and uses its server amount',()=>{
  render(<BookingFacts summary={summary} checkout totalPaise={12345} />)
  expect(screen.getByText('Total payable')).toBeVisible()
  expect(screen.getByText('₹123.45')).toBeVisible()
  expect(screen.queryByText(/server total|added by this client/i)).not.toBeInTheDocument()
})
it('uses instant home scrolling when reduced motion is requested', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches:true, addEventListener:()=>{}, removeEventListener:()=>{} }))
  window.history.replaceState({}, '', '/'); mockApi(); render(<App />)
  await userEvent.click(screen.getByRole('link',{name:'CineHook'}))
  expect(window.scrollTo).toHaveBeenCalledWith({top:0,left:0,behavior:'instant'})
})
it('opens a category card detail page and never starts unsupported booking or payment', async () => {
  window.history.replaceState({}, '', '/events')
  const calls=mockApi(path=>path==='/api/demo-catalog/events'?ok(page([listing])):path===`/api/demo-catalog/events/${listing.id}`?ok({listing}):undefined)
  render(<App />)
  const link=await screen.findByRole('link',{name:'Open Laugh Lines'})
  await userEvent.click(link)
  expect(await screen.findByRole('heading',{name:'Laugh Lines',level:1})).toBeVisible()
  expect(window.location.pathname).toBe(`/events/${listing.id}`)
  expect(screen.getByRole('button',{name:'Coming soon'})).toBeDisabled()
  expect(screen.getByText('Spotlight Studio')).toBeVisible()
  expect(screen.queryByText(listing.description)).not.toBeInTheDocument()
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  expect(screen.getByRole('navigation',{name:'Categories'}).querySelector('[aria-current="page"]')).toHaveTextContent('Events')
  expect(calls.some(c=>c.path==='/api/bookings'||c.path.startsWith('/api/payments/'))).toBe(false)
  await userEvent.click(screen.getByRole('link',{name:'Back to Events'}))
  expect(await screen.findByRole('heading',{name:'Laugh Lines',level:2})).toBeVisible()
})
it('changes the selected city in category reads without showing a stale page of old-city results', async () => {
  window.history.replaceState({}, '', '/sports')
  let release!:(value:Response)=>void
  const requests:URL[]=[]
  mockApi((path,_options,url)=>path==='/api/demo-catalog/sports'?(requests.push(url),url.searchParams.has('cityId')?new Promise(resolve=>{release=resolve}):ok(page([{...listing,kind:'SPORTS'}]))):undefined)
  render(<App />)
  await screen.findByRole('heading',{name:'Laugh Lines',level:1})
  await userEvent.click(screen.getByRole('button',{name:'All cities'}))
  const dialog=screen.getByRole('dialog')
  await userEvent.type(within(dialog).getByRole('searchbox'),city.name)
  await userEvent.click(await within(dialog).findByRole('radio',{name:city.name}))
  await userEvent.click(within(dialog).getByRole('button',{name:'Save location'}))
  await waitFor(()=>expect(requests.at(-1)?.searchParams.get('cityId')).toBe(ids.city))
  expect(screen.queryAllByRole('heading',{name:'Laugh Lines'})).toHaveLength(0)
  await act(async()=>release(ok(page([]))))
  expect(await screen.findByRole('heading',{name:'No experiences found'})).toBeVisible()
})
it('waits for a saved city before requesting physical experiences', async () => {
  sessionStorage.setItem('cinehook.city',ids.city)
  window.history.replaceState({}, '', '/events')
  let release!:(value:Response)=>void
  const requests:URL[]=[]
  mockApi((path,_options,url)=>path==='/api/cities'?new Promise(resolve=>{release=resolve}):path==='/api/demo-catalog/events'?(requests.push(url),ok(page([listing]))):undefined)
  render(<App />)
  await act(async()=>{await Promise.resolve()})
  expect(requests).toHaveLength(0)
  await act(async()=>release(ok(page([city]))))
  await waitFor(()=>expect(requests.some(url=>url.searchParams.get('cityId')===ids.city)).toBe(true))
})
it('retains an informative unavailable screen for a missing listing and can retry a detail read', async () => {
  window.history.replaceState({}, '', `/events/${listing.id}`)
  let available=false
  mockApi(path=>path===`/api/demo-catalog/events/${listing.id}`?available?ok({listing}):failure(404,'LISTING_NOT_FOUND','private metadata'):undefined)
  render(<App />)
  expect(await screen.findByRole('alert')).toHaveTextContent('This item could not be found.')
  available=true
  await userEvent.click(screen.getByRole('button',{name:'Retry'}))
  expect(await screen.findByRole('heading',{name:'Laugh Lines',level:1})).toBeVisible()
})
it('labels existing footer graphics and keeps their supported destinations', async()=>{
  window.history.replaceState({}, '', '/'); mockApi(); render(<App />)
  const footer=screen.getByRole('contentinfo')
  expect(within(footer).getByText('Customer Care / Support')).toBeVisible()
  expect(within(footer).getByText('About Developer')).toBeVisible()
  const support=within(footer).getByRole('link',{name:'Customer Care / Support'})
  expect(support.querySelector('svg')).not.toBeNull()
  expect(within(footer).getByRole('link',{name:'About Developer'})).toHaveAttribute('href','https://portfolio-gold-eight-71.vercel.app/#')
  expect(footer).not.toHaveTextContent(/created for educational|portfolio purposes/i)
  expect(footer).not.toHaveTextContent(/sample|seed|fictional|demo/i)
  await userEvent.click(support)
  expect(await screen.findByRole('heading',{name:'How can we help?'})).toBeVisible()
})
it('shows a graphical location pin beside the persistent city and restores focus when the menu closes', async()=>{
  sessionStorage.setItem('cinehook.access-token','unit-access-token')
  sessionStorage.setItem('cinehook.city',ids.city)
  window.history.replaceState({}, '', '/'); mockApi(); render(<App />)
  const location=await screen.findByRole('button',{name:city.name})
  expect(location.querySelector('svg')).not.toBeNull()
  const menu=screen.getByRole('button',{name:/Cinema Fan account menu/i})
  await userEvent.click(menu)
  const accountMenu=screen.getByRole('navigation',{name:'Account menu'})
  await userEvent.click(within(accountMenu).getByRole('link',{name:'Account Info'}))
  await waitFor(()=>expect(screen.queryByRole('navigation',{name:'Account menu'})).not.toBeInTheDocument())
  expect(screen.queryByRole('navigation', { name: 'Categories' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('link', { name: '← Back' }))
  await userEvent.click(await screen.findByRole('button',{name:/Cinema Fan account menu/i}))
  within(screen.getByRole('navigation',{name:'Account menu'})).getByRole('link',{name:'My Bookings'}).focus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('navigation',{name:'Account menu'})).not.toBeInTheDocument()
  expect(screen.getByRole('button',{name:/Cinema Fan account menu/i})).toHaveFocus()
})
