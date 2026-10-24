import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {expect,it,vi} from 'vitest'
import App from '../src/App'
import {failure,mockApi,ok} from './fixtures'

async function details(){
  await userEvent.type(screen.getByLabelText('Name'),'Cinema Fan')
  await userEvent.type(screen.getByLabelText('Mobile number'),'+919876543210')
  await userEvent.type(screen.getByLabelText('Email'),'new@example.com')
  await userEvent.type(screen.getByLabelText('Password',{exact:true}),'safe-password-123')
  await userEvent.type(screen.getByLabelText('Confirm password'),'safe-password-123')
}
it('collects details first, verifies OTP on the server and requires login after success',async()=>{
  window.history.replaceState({},'','/register')
  const calls=mockApi(path=>path.endsWith('/ownership/request')?ok({challengeId:'c'.repeat(43)}):path.endsWith('/ownership/verify')?ok({token:'t'.repeat(43)}):undefined)
  render(<App/>); await details(); await userEvent.click(screen.getByRole('button',{name:'Continue'}))
  expect(await screen.findByLabelText('Verification code')).toBeVisible()
  expect(calls.some(c=>c.path==='/api/auth/register')).toBe(false)
  await userEvent.type(screen.getByLabelText('Verification code'),'123456')
  await userEvent.click(screen.getByRole('button',{name:'Verify OTP'}))
  expect(await screen.findByRole('status')).toHaveTextContent(/verified/i)
  expect(screen.getByRole('link',{name:'Continue to login'})).toHaveAttribute('href','/login?returnTo=%2F')
  expect(sessionStorage.getItem('cinehook.access-token')).toBeNull()
  const payload=JSON.parse(String(calls.find(c=>c.path==='/api/auth/register')?.options.body))
  expect(payload).toMatchObject({email:'new@example.com',phone:'+919876543210',registrationToken:'t'.repeat(43)})
  expect(JSON.stringify(sessionStorage)).not.toContain('safe-password-123')
})
it('keeps rejected registration OTP on the verification step without activating an account',async()=>{
  window.history.replaceState({},'','/register')
  const calls=mockApi(path=>path.endsWith('/ownership/request')?ok({challengeId:'c'.repeat(43)}):path.endsWith('/ownership/verify')?failure(400,'OWNERSHIP_PROOF_INVALID','expired'):undefined)
  render(<App/>);await details();await userEvent.click(screen.getByRole('button',{name:'Continue'}))
  await userEvent.type(await screen.findByLabelText('Verification code'),'000000');await userEvent.click(screen.getByRole('button',{name:'Verify OTP'}))
  expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or expired/i)
  expect(calls.some(c=>c.path==='/api/auth/register')).toBe(false)
  expect(screen.getByRole('button',{name:'Resend OTP'})).toBeDisabled()
})
it('removes the recovery selector without weakening the ordinary recovery endpoint',async()=>{
  window.history.replaceState({},'','/forgot-password');const calls=mockApi(path=>path==='/api/auth/forgot-password'?ok({challengeId:'c'.repeat(43),message:'Check your inbox'}):undefined)
  render(<App/>);expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Email address'),'owner@example.com');await userEvent.click(screen.getByRole('button',{name:'Send OTP'}))
  expect(await screen.findByLabelText('Verification code')).toBeVisible()
  expect(calls.some(c=>c.path==='/api/auth/ownership/complete')).toBe(false)
})
it('cancels logout without losing the session, then confirms revocation before clearing it',async()=>{
  sessionStorage.setItem('cinehook.access-token','active-token');window.history.replaceState({},'','/bookings')
  const calls=mockApi(path=>path==='/api/auth/logout'?ok({message:'Signed out'}):undefined)
  render(<App/>);await userEvent.click(await screen.findByRole('button',{name:'Logout'}))
  let dialog=screen.getByRole('dialog',{name:'Are you sure you want to log out?'})
  expect(within(dialog).getByRole('button',{name:'Cancel'})).toHaveFocus()
  await userEvent.click(within(dialog).getByRole('button',{name:'Cancel'}))
  expect(sessionStorage.getItem('cinehook.access-token')).toBe('active-token')
  expect(calls.some(c=>c.path==='/api/auth/logout')).toBe(false)
  await userEvent.click(screen.getByRole('button',{name:'Logout'}));dialog=screen.getByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button',{name:'Logout'}))
  await waitFor(()=>expect(sessionStorage.getItem('cinehook.access-token')).toBeNull())
  expect(calls.filter(c=>c.path==='/api/auth/logout')).toHaveLength(1)
})
it('keeps the session and allows retry when logout revocation fails',async()=>{
  sessionStorage.setItem('cinehook.access-token','active-token');window.history.replaceState({},'','/bookings')
  mockApi(path=>path==='/api/auth/logout'?failure(503,'AUTH_TEMPORARILY_UNAVAILABLE','unavailable'):undefined)
  render(<App/>);await userEvent.click(await screen.findByRole('button',{name:'Logout'}))
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Logout'}))
  expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i)
  expect(sessionStorage.getItem('cinehook.access-token')).toBe('active-token')
})
it('keeps keyboard focus inside header logout confirmation even while revocation is pending',async()=>{
  sessionStorage.setItem('cinehook.access-token','active-token')
  let finish!:(response:Response)=>void
  mockApi(path=>path==='/api/auth/logout'?new Promise<Response>(resolve=>{finish=resolve}):undefined)
  render(<App/>);await userEvent.click(await screen.findByRole('button',{name:'Cinema Fan account menu'}))
  await userEvent.click(within(screen.getByRole('navigation',{name:'Account menu'})).getByRole('button',{name:'Logout'}))
  const dialog=screen.getByRole('dialog')
  within(dialog).getByRole('button',{name:'Logout'}).focus()
  await userEvent.keyboard('{Enter}');await userEvent.keyboard('{Escape}')
  expect(dialog).toContainElement(document.activeElement as HTMLElement)
  await act(async()=>finish(ok({message:'Signed out'})))
})
it('returns focus to the visible header logout trigger after cancelling the modal',async()=>{
  sessionStorage.setItem('cinehook.access-token','active-token');mockApi();render(<App/>)
  await userEvent.click(await screen.findByRole('button',{name:'Cinema Fan account menu'}))
  const trigger=within(screen.getByRole('navigation',{name:'Account menu'})).getByRole('button',{name:'Logout'})
  await userEvent.click(trigger)
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Cancel'}))
  expect(trigger).toHaveFocus();expect(screen.getByRole('navigation',{name:'Account menu'})).toBeVisible()
})
it('shows loading during a delayed anonymous homepage request without duplicate calls',async()=>{
  let finish!:(response:Response)=>void
  const calls=mockApi(path=>path==='/api/movies'?new Promise<Response>(resolve=>{finish=resolve}):undefined)
  render(<App/>);expect(await screen.findByRole('status')).toHaveTextContent(/Loading|Detecting|Finding|Setting/i)
  await waitFor(()=>expect(calls.filter(c=>c.path==='/api/movies')).toHaveLength(1))
  await act(async()=>finish(ok({items:[],page:1,limit:20})))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
it('resends registration only after cooldown and verifies the replacement challenge',async()=>{
  window.history.replaceState({},'','/register');let requests=0
  const calls=mockApi(path=>path.endsWith('/ownership/request')?ok({challengeId:(++requests===1?'a':'b').repeat(43)}):path.endsWith('/ownership/verify')?ok({token:'t'.repeat(43)}):undefined)
  render(<App/>);await details();vi.useFakeTimers()
  try{
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Continue'}))})
    expect(screen.getByRole('button',{name:'Resend OTP'})).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Verification code'),{target:{value:'123456'}})
    await act(async()=>vi.advanceTimersByTimeAsync(60000))
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Resend OTP'}))})
    expect(screen.getByLabelText('Verification code')).toHaveValue('')
    expect(calls.filter(c=>c.path.endsWith('/ownership/request'))).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Verification code'),{target:{value:'654321'}})
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Verify OTP'}))})
    const verification=calls.find(c=>c.path.endsWith('/ownership/verify'))!
    expect(JSON.parse(String(verification.options.body))).toEqual({challengeId:'b'.repeat(43),otp:'654321'})
    expect(screen.getByRole('status')).toHaveTextContent('Email verified')
  }finally{vi.useRealTimers()}
})
