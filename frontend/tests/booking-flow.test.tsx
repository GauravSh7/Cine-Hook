import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import App from '../src/App'
import { booking, failure, ids, mockApi, ok, payment, summary } from './fixtures'

it('obsolete order cannot open checkout after navigating to a different booking', async () => {
  visit(); let resolveOrder!: (response: Response) => void; const open = vi.fn()
  const other = '10000000-0000-4000-8000-000000000099'
  mockApi(path => {
    if (path === '/api/payments/order') return new Promise<Response>(resolve => { resolveOrder = resolve })
    if (path === `/api/bookings/${other}/summary`) return ok({ ...summary, booking: { ...booking, id: other } })
  })
  vi.stubGlobal('Razorpay', class { on() {} open = open; close() {} })
  render(<App />); await userEvent.click(await screen.findByRole('button', { name: /^Proceed to payment/i }))
  act(() => { window.history.pushState({}, '', `/bookings/${other}/checkout`); window.dispatchEvent(new PopStateEvent('popstate')) })
  expect(await screen.findByRole('heading', { name: 'Checkout' })).toBeVisible()
  await act(async () => resolveOrder(ok({ payment, order: { id: payment.providerOrderId, amountPaise: 12345, currency: 'INR', receipt: payment.id, keyId: 'rzp_test_fixture' }, expiresAt: booking.expiresAt })))
  expect(open).not.toHaveBeenCalled()
  expect(window.location.pathname).toBe(`/bookings/${other}/checkout`)
})
it('cancellation confirmation is discarded when changing booking identity', async () => {
  visit(`/bookings/${ids.booking}`)
  const other = '10000000-0000-4000-8000-000000000099'
  mockApi(path => path.endsWith('/summary') ? ok({ ...summary, booking: { ...booking, id: path.includes(other) ? other : ids.booking, status: 'CONFIRMED' }, payment: { ...payment, status: 'SUCCESS' } }) : undefined)
  render(<App />); await userEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }))
  expect(screen.getByRole('dialog')).toBeVisible()
  act(() => { window.history.pushState({}, '', `/bookings/${other}`); window.dispatchEvent(new PopStateEvent('popstate')) })
  await screen.findByRole('heading', { name: 'Payment Successful' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('cancellation dialog traps keyboard focus and Escape restores its trigger', async () => {
  visit(`/bookings/${ids.booking}`)
  mockApi(path => path.endsWith('/summary') ? ok({ ...summary, booking: { ...booking, status: 'CONFIRMED' }, payment: { ...payment, status: 'SUCCESS' } }) : undefined)
  const keyboard = userEvent.setup(); render(<App />)
  const trigger = await screen.findByRole('button', { name: 'Cancel booking' }); await keyboard.click(trigger)
  const keep = screen.getByRole('button', { name: 'Keep booking' }), cancel = screen.getByRole('button', { name: 'Confirm cancellation' })
  expect(keep).toHaveFocus(); await keyboard.tab({ shift: true }); expect(cancel).toHaveFocus()
  await keyboard.tab(); expect(keep).toHaveFocus(); await keyboard.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(trigger).toHaveFocus()
})

function visit(path = `/bookings/${ids.booking}/checkout`) {
  sessionStorage.setItem('cinehook.access-token', 'unit-access-token')
  window.history.replaceState({}, '', path)
}
it('permits a server bill preview without enabling payment on simulated development quotes',async()=>{
  visit();const calls=mockApi(path=>path.endsWith('/quote')?ok({version:1,label:'Simulated order summary',simulated:true,paymentAllowed:false,frozen:false,couponCode:null,subtotalPaise:20000,discountPaise:0,discountedPaise:20000,ticketBasePaise:16949,admissionTaxPaise:3051,feePaise:700,feeTaxPaise:126,totalPaise:20826}):undefined);
  render(<App/>);await screen.findByText('Show Bill');
  expect(screen.getByRole('button',{name:/Proceed to payment/})).toBeDisabled();
  expect(screen.getByText('Payments unavailable')).toBeVisible();
  expect(calls.some(c=>c.path==='/api/payments/order')).toBe(false);
});
it('renders the physical theatre below checkout facts and marks held seats without changing selection',async()=>{
  visit();const calls=mockApi();render(<App/>);
  const map=await screen.findByRole('region',{name:'Your seats in the theatre'});
  expect(map).toHaveTextContent('SCREEN');expect(screen.getByLabelText('A1, your selected seat')).toBeVisible();
  expect(screen.getByLabelText('A2, other seat')).toBeVisible();expect(screen.getByLabelText('A3, other seat')).toBeVisible();
  expect(screen.getByRole('timer')).toHaveTextContent('Pay within');
  expect(map.querySelectorAll('button')).toHaveLength(0);
  expect(calls.filter(c=>c.path==='/api/bookings'&&c.options.method==='POST')).toHaveLength(0);
});
it('checkout displays the persisted quote and backend hold countdown, not prototype fees', async () => {
  visit(); mockApi(); render(<App />)
  expect(await screen.findByRole('heading', { name: 'Booking summary' })).toBeVisible()
  expect(screen.getAllByText('₹123.45').length).toBeGreaterThan(0)
  expect(screen.getByRole('timer')).toHaveTextContent(/0[45]:\d{2}/)
  expect(screen.queryByText('₹650')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Proceed to payment/i })).toBeEnabled()
})
it('cancel payment cancels through the backend and stops the countdown', async () => {
  visit(); let cancelled=false
  const calls = mockApi(path => {
    if(path.endsWith('/checkout/cancel')) {cancelled=true;return ok({booking:{...booking,status:'CANCELLED'}})}
    if(path.endsWith('/summary')) return ok({...summary,booking:{...booking,status:cancelled?'CANCELLED':'PENDING'}})
  }); render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel payment' }))
  await waitFor(() => expect(window.location.pathname).toBe(`/bookings/${ids.booking}`))
  expect(await screen.findByRole('heading', { name: 'Booking cancelled' })).toBeVisible()
  expect(calls.find(call=>call.path.endsWith('/checkout/cancel'))?.options.method).toBe('POST')
  expect(calls.some(call => call.path === '/api/payments/order')).toBe(false)
  expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Refresh status' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Release unpaid hold' })).not.toBeInTheDocument()
})
it('provider failure cancels checkout through the backend instead of leaving a timer running',async()=>{
  visit();let cancelled=false,failed:(()=>void)|undefined;
  const calls=mockApi(path=>{
    if(path.endsWith('/checkout/cancel')){cancelled=true;return ok({booking:{id:ids.booking,status:'CANCELLED'}})}
    if(path.endsWith('/summary')&&cancelled)return ok({...summary,booking:{...booking,status:'CANCELLED'},payment:{...payment,status:'FAILED'}});
  });
  vi.stubGlobal('Razorpay',class {on(_name:string,handler:()=>void){failed=handler}open(){}close(){}});
  render(<App/>);await userEvent.click(await screen.findByRole('button',{name:/^Proceed to payment/i}));await waitFor(()=>expect(failed).toBeDefined());await act(async()=>failed!());
  await waitFor(()=>expect(window.location.pathname).toBe(`/bookings/${ids.booking}`));
  expect(await screen.findByRole('heading',{name:'Booking cancelled'})).toBeVisible();
  expect(calls.filter(c=>c.path.endsWith('/checkout/cancel'))).toHaveLength(1);expect(screen.queryByRole('timer')).not.toBeInTheDocument();
});
it('an expired backend deadline disables initiating payment', async () => {
  visit(); mockApi(path => path.endsWith('/summary') ? ok({ ...summary, booking: { ...booking, expiresAt: '2020-01-01T00:00:00Z' } }) : undefined)
  render(<App />); expect(await screen.findByText(/hold has expired/i)).toBeVisible()
  expect(screen.getByRole('button', { name: /^Proceed to payment/i })).toBeDisabled()
})
it('failed cancellation never pretends the booking was cancelled',async()=>{
  visit();mockApi(path=>path.endsWith('/checkout/cancel')?failure(503,'UNAVAILABLE','Unavailable'):undefined)
  render(<App/>);await userEvent.click(await screen.findByRole('button',{name:'Cancel payment'}))
  await screen.findByRole('alert')
  expect(window.location.pathname).toBe(`/bookings/${ids.booking}/checkout`)
  expect(screen.getByRole('timer')).toBeVisible()
  expect(screen.queryByRole('heading',{name:'Booking cancelled'})).not.toBeInTheDocument()
})
it('captured cancellation displays the authoritative refund rather than a ticket or timer',async()=>{
  visit();let cancelled=false
  mockApi(path=>{
    if(path.endsWith('/checkout/cancel')) {cancelled=true;return ok({booking:{id:ids.booking,status:'CANCELLED'}})}
    if(path.endsWith('/summary'))return ok({...summary,booking:{...booking,status:cancelled?'CANCELLED':'PENDING'},payment:cancelled?{...payment,status:'REFUND_PENDING'}:null})
  })
  render(<App/>);await userEvent.click(await screen.findByRole('button',{name:'Cancel payment'}))
  expect(await screen.findByRole('heading',{name:'Refund In Process'})).toBeVisible()
  expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  expect(screen.queryByRole('button',{name:/Download ticket/})).not.toBeInTheDocument()
})
it('SDK success with backend payment SUCCESS but no confirmed booking never renders a ticket', async () => {
  visit()
  let captured = false
  mockApi(path => {
    if (path === '/api/payments/verify') { captured = true; return ok({ payment: { ...payment, status: 'SUCCESS' } }) }
    if (path.endsWith('/summary')) return ok({ ...summary, payment: captured ? { ...payment, status: 'SUCCESS' } : null })
  })
  vi.stubGlobal('Razorpay', class {
    options: { handler: (data: unknown) => void }
    constructor(options: { handler: (data: unknown) => void }) { this.options = options }
    on() {}
    open() { this.options.handler({ razorpay_order_id: 'order_controlled', razorpay_payment_id: 'pay_controlled', razorpay_signature: 'a'.repeat(64) }) }
    close() {}
  })
  render(<App />); await userEvent.click(await screen.findByRole('button', { name: /^Proceed to payment/i }))
  await waitFor(() => expect(window.location.pathname).toBe(`/bookings/${ids.booking}`))
  expect(await screen.findByText(/payment received.*confirmation|confirmation.*pending/i)).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Payment Successful' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Download ticket/i })).not.toBeInTheDocument()
})
it('verified backend booking confirmation creates the factual ticket after SDK callback', async () => {
  visit(); let captured = false
  const calls = mockApi(path => {
    if (path === '/api/payments/verify') { captured = true; return ok({ payment: { ...payment, status: 'SUCCESS' } }) }
    if (path.endsWith('/summary')) return ok({ ...summary, booking: captured ? { ...booking, status: 'CONFIRMED' } : booking,
      payment: captured ? { ...payment, status: 'SUCCESS', providerPaymentId: 'pay_controlled' } : null })
  })
  vi.stubGlobal('Razorpay', class {
    options: { handler: (data: unknown) => void }
    constructor(options: { handler: (data: unknown) => void }) { this.options = options }
    on() {}
    open() { this.options.handler({ razorpay_order_id: 'order_controlled', razorpay_payment_id: 'pay_controlled', razorpay_signature: 'a'.repeat(64) }) }
    close() {}
  })
  render(<App />); await userEvent.click(await screen.findByRole('button', { name: /^Proceed to payment/i }))
  expect(await screen.findByRole('heading', { name: 'Payment Successful' })).toBeVisible()
  expect(screen.getByRole('button', { name: /Download ticket/i })).toBeEnabled()
  const verify = calls.find(call => call.path === '/api/payments/verify')!
  expect(JSON.parse(String(verify.options.body))).toEqual({ bookingId: ids.booking, razorpay_order_id: 'order_controlled',
    razorpay_payment_id: 'pay_controlled', razorpay_signature: 'a'.repeat(64) })
})
it('uncertain backend verification reports recovery rather than claiming success', async () => {
  visit(); mockApi(path => path === '/api/payments/verify' ? failure(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Verification unavailable.') : undefined)
  vi.stubGlobal('Razorpay', class {
    options: { handler: (data: unknown) => void }
    constructor(options: { handler: (data: unknown) => void }) { this.options = options }
    on() {}
    open() { this.options.handler({ razorpay_order_id: 'order_controlled', razorpay_payment_id: 'pay_controlled', razorpay_signature: 'a'.repeat(64) }) }
    close() {}
  })
  render(<App />); await userEvent.click(await screen.findByRole('button', { name: /^Proceed to payment/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/verification|recover/i)
  expect(screen.queryByRole('heading', { name: 'Payment Successful' })).not.toBeInTheDocument()
})
it('browser reload recovers a webhook-confirmed booking from the backend without another payment', async () => {
  visit(`/bookings/${ids.booking}`)
  const calls = mockApi(path => path.endsWith('/summary') ? ok({ ...summary, booking: { ...booking, status: 'CONFIRMED' },
    payment: { ...payment, status: 'SUCCESS' } }) : undefined)
  render(<App />); expect(await screen.findByRole('heading', { name: 'Payment Successful' })).toBeVisible()
  expect(calls.some(call => call.path === '/api/payments/order' || call.path === '/api/payments/verify')).toBe(false)
})
it('cancellation remains cancelled while full refund is pending and sends no client amount', async () => {
  visit(`/bookings/${ids.booking}`); let cancelled = false
  const refund = { id: 'refund_unit', providerPaymentId: 'pay_controlled', amountPaise: 12345, currency: 'INR', reason: 'BOOKING_CANCELLED', status: 'PENDING', attempts: [] }
  const calls = mockApi(path => {
    if (path.endsWith('/cancel')) { cancelled = true; return ok({ ...summary, booking: { id: ids.booking, status: 'CANCELLED', totalPaise: 12345 },
      payment: { ...payment, status: 'REFUND_PENDING' }, refunds: [refund] }, 202) }
    if (path.endsWith('/summary')) return ok({ ...summary, booking: { ...booking, status: cancelled ? 'CANCELLED' : 'CONFIRMED' },
      payment: { ...payment, status: cancelled ? 'REFUND_PENDING' : 'SUCCESS' }, refunds: cancelled ? [refund] : [] })
  })
  render(<App />); await userEvent.click(await screen.findByRole('button', { name: /^Cancel booking$/i }))
  await userEvent.click(screen.getByRole('button', { name: /Confirm cancellation/i }))
  expect(await screen.findByRole('heading', { name: /Refund In Process/i })).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Cancel booking$/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Download ticket/i })).not.toBeInTheDocument()
  expect(JSON.parse(String(calls.find(call => call.path.endsWith('/cancel'))!.options.body))).toEqual({})
})
it('does not reopen cancellation when the confirmed cancellation response arrives before a stale summary refresh', async () => {
  visit(`/bookings/${ids.booking}`)
  const calls = mockApi(path => path.endsWith('/cancel')
    ? ok({ booking: { id: ids.booking, status: 'CANCELLED', totalPaise: 12345 }, payment: { ...payment, status: 'REFUND_PENDING' }, refunds: [] }, 202)
    : path.endsWith('/summary') ? ok({ ...summary, booking: { ...booking, status: 'CONFIRMED' }, payment: { ...payment, status: 'SUCCESS' } }) : undefined)
  render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: /^Cancel booking$/i }))
  await userEvent.click(screen.getByRole('button', { name: /Confirm cancellation/i }))
  expect(await screen.findByRole('heading', { name: 'Booking cancelled' })).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Cancel booking$/i })).not.toBeInTheDocument()
  expect(calls.some(call => call.path.endsWith('/cancel'))).toBe(true)
})
it('unfulfilled captured payment shows full compensation rather than a confirmed ticket', async () => {
  visit(`/bookings/${ids.booking}`)
  mockApi(path => path.endsWith('/summary') ? ok({ ...summary, booking: { ...booking, status: 'FAILED', failureCode: 'HOLD_EXPIRED' },
    payment: { ...payment, status: 'REFUND_PENDING' } }) : undefined)
  render(<App />); expect(await screen.findByRole('heading', { name: /Refund In Process/i })).toBeVisible()
  expect(screen.getByText(/Booking could not be completed/i)).toBeVisible()
})
it('refresh on focus observes authoritative refund completion', async () => {
  visit(`/bookings/${ids.booking}`); let returned = false
  mockApi(path => path.endsWith('/summary') ? ok({ ...summary, booking: { ...booking, status: 'CANCELLED' },
    payment: { ...payment, status: returned ? 'REFUNDED' : 'REFUND_PENDING' } }) : undefined)
  render(<App />); expect(await screen.findByRole('heading', { name: /Refund In Process/i })).toBeVisible()
  returned = true; act(() => window.dispatchEvent(new Event('focus')))
  expect(await screen.findByRole('heading', { name: /Refund complete/i })).toBeVisible()
})
it('history actions follow the newer summary state, not a stale confirmed list entry', async () => {
  visit('/bookings')
  mockApi(path => {
    if (path === '/api/bookings') return ok({ items: [{ ...booking, status: 'CONFIRMED' }], page: 1, limit: 20 })
    if (path.endsWith('/summary')) return ok({ ...summary, booking: { ...booking, status: 'CANCELLED' }, payment: { ...payment, status: 'REFUND_PENDING' } })
  })
  render(<App />); await screen.findByText('REFUND PENDING')
  expect(screen.getByRole('link', { name: 'View status / refund' })).toBeVisible()
  expect(screen.queryByRole('link', { name: 'View ticket' })).not.toBeInTheDocument()
})
it('an expired failed booking shows a focused status without rebooking or renewal actions', async () => {
  visit(`/bookings/${ids.booking}`)
  mockApi(path => path.endsWith('/summary') ? ok({ ...summary, booking: { ...booking, status: 'FAILED', failureCode: 'HOLD_EXPIRED' } }) : undefined)
  render(<App />); expect(await screen.findByRole('heading', { name: 'Booking not completed' })).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Select seats again' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Continue checkout/ })).not.toBeInTheDocument()
})
