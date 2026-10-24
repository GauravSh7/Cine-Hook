import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ok, user, failure } from './fixtures'

afterEach(() => { delete window.google; document.querySelectorAll('script[data-cinehook-google]').forEach(s => s.remove()); vi.restoreAllMocks() })
const result = { user, accessToken: 'google-application-token', tokenType: 'Bearer' }
it('renders the official Google button directly without an intermediate application button',async()=>{
  fixture();const {GoogleSignIn}=await import('../src/components/GoogleSignIn');render(<GoogleSignIn onSuccess={vi.fn()}/>);
  expect(await screen.findByRole('button',{name:'Official Google test button'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Continue with Google'})).not.toBeInTheDocument();
});
function fixture(configured = true) {
  let callback: ((r: { credential?: string }) => void) | undefined
  const calls: string[] = []
  const initialize = vi.fn((options: Parameters<NonNullable<Window['google']>['accounts']['id']['initialize']>[0]) => { callback = options.callback })
  window.google = { accounts: { id: { initialize, renderButton: vi.fn((element: HTMLElement) => { const b = document.createElement('button'); b.textContent = 'Official Google test button'; element.append(b) }), cancel: vi.fn() } } }
  vi.stubGlobal('fetch', vi.fn(async (path: string) => { calls.push(path); return path.endsWith('/config') ? ok({ clientId: configured ? '123-test.apps.googleusercontent.com' : null }) : path.endsWith('/challenge') ? ok({ nonce: 'n'.repeat(43), csrfToken: 'c'.repeat(43), expiresAt: Math.floor(Date.now() / 1000) + 300 }) : ok(result) }))
  return { calls, initialize, respond: () => { callback?.({ credential: 'provider-test-token' }) } }
}
it('requests browser-mediated Google account selection without automatic account acceptance',async()=>{
  const f=fixture(),success=vi.fn();const {GoogleSignIn}=await import('../src/components/GoogleSignIn');render(<GoogleSignIn onSuccess={success}/>);
  await screen.findByText('Official Google test button');
  expect(f.initialize.mock.calls[0]?.[0]).toMatchObject({use_fedcm_for_button:true,button_auto_select:false,auto_select:false,nonce:'n'.repeat(43)});
  expect(success).not.toHaveBeenCalled();await act(async()=>f.respond());await waitFor(()=>expect(success).toHaveBeenCalledWith(result));
});
it('keeps unconfigured Google unavailable without loading its SDK', async () => {
  fixture(false); const { GoogleSignIn } = await import('../src/components/GoogleSignIn'); render(<GoogleSignIn onSuccess={vi.fn()} />)
  expect(await screen.findByText(/Google sign-in is not configured/)).toBeVisible()
  expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).toBeNull()
})
it('uses the verified API result and never stores a provider credential', async () => {
  const f = fixture(), success = vi.fn(); const { GoogleSignIn } = await import('../src/components/GoogleSignIn'); render(<GoogleSignIn onSuccess={success} />)
  await screen.findByText('Official Google test button'); await act(async () => f.respond()); await waitFor(() => expect(success).toHaveBeenCalledWith(result))
  expect(JSON.stringify(sessionStorage)).not.toContain('provider-test-token')
  expect(f.initialize.mock.calls[0]![0]).toMatchObject({ nonce: 'n'.repeat(43), auto_select: false, ux_mode: 'popup' })
})
it('never auto-links a collision from the login form and directs users to safe recovery',async()=>{
  const f=fixture(),success=vi.fn(),base=globalThis.fetch;let link:RequestInit|undefined,proofCalls=0;
  vi.stubGlobal('fetch',async(path:string,options:RequestInit)=>{
    if(path==='/api/auth/google')return failure(409,'GOOGLE_EMAIL_CONFLICT','Existing account');
    if(path==='/api/auth/login'){proofCalls++;return ok({...result,accessToken:'password-proof-token'})}
    if(path==='/api/auth/google/link'){link=options;return ok(result)}
    return base(path,options);
  });
  const {GoogleSignIn}=await import('../src/components/GoogleSignIn');render(<GoogleSignIn existingAccount={{email:user.email,password:'existing-password-123'}} onSuccess={success}/>);
  await screen.findByText('Official Google test button');await act(async()=>f.respond());
  expect(await screen.findByRole('alert')).not.toHaveTextContent('Account Info');expect(success).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Retry Google sign-in'})).toBeEnabled();
  expect(screen.getByRole('link',{name:'Verify account ownership'})).toHaveAttribute('href','/forgot-password');
  await userEvent.click(screen.getByRole('button',{name:'Retry Google sign-in'}));await screen.findByText('Official Google test button');await act(async()=>f.respond());
  expect(success).not.toHaveBeenCalled();expect(proofCalls).toBe(0);expect(link).toBeUndefined();
  expect(JSON.stringify(sessionStorage)).not.toContain('existing-password-123');expect(JSON.stringify(sessionStorage)).not.toContain('password-proof-token');
});
it('sends password-confirmed linking to the protected endpoint and does not persist the password',async()=>{
  const f=fixture(),success=vi.fn(),fetcher=globalThis.fetch;let linked:RequestInit|undefined;
  vi.stubGlobal('fetch',async(path:string,options:RequestInit)=>{if(path==='/api/auth/google/link')linked=options;return fetcher(path,options)});
  const {GoogleSignIn}=await import('../src/components/GoogleSignIn');render(<GoogleSignIn mode="link" password="existing-password-123" onSuccess={success}/>);
  await screen.findByText('Official Google test button');await act(async()=>f.respond());
  await waitFor(()=>expect(success).toHaveBeenCalledWith(result));expect(JSON.parse(String(linked?.body))).toMatchObject({password:'existing-password-123',credential:'provider-test-token',csrfToken:'c'.repeat(43)});
  expect(JSON.stringify(sessionStorage)).not.toContain('existing-password-123');
});
it('requires explicit legacy Google security consent and obtains fresh Google evidence before confirmation', async () => {
  const f=fixture(),success=vi.fn(),fetcher=globalThis.fetch;const submissions:unknown[]=[];
  vi.stubGlobal('fetch',async(path:string,options:RequestInit)=>{
    if(path==='/api/auth/google') {const body=JSON.parse(String(options.body));submissions.push(body);return body.confirmOwnership===true?ok(result):failure(403,'GOOGLE_OWNERSHIP_CONFIRMATION_REQUIRED','Confirm security change')}
    return fetcher(path,options)
  });
  const {GoogleSignIn}=await import('../src/components/GoogleSignIn');render(<GoogleSignIn onSuccess={success}/>);
  await screen.findByText('Official Google test button');await act(async()=>f.respond());
  expect(success).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('checkbox',{name:/Remove the old unverified password/}));
  await screen.findByText('Official Google test button');await act(async()=>f.respond());
  await waitFor(()=>expect(success).toHaveBeenCalledWith(result));
  expect(submissions).toHaveLength(2);expect(submissions[1]).toMatchObject({confirmOwnership:true});
  expect(f.initialize).toHaveBeenCalledTimes(2);
});
it('ignores an abandoned callback after unmount', async () => {
  const f = fixture(), success = vi.fn(); const { GoogleSignIn } = await import('../src/components/GoogleSignIn'); const view = render(<GoogleSignIn onSuccess={success} />)
  await screen.findByText('Official Google test button'); view.unmount(); await act(async () => f.respond())
  expect(success).not.toHaveBeenCalled(); expect(f.calls.filter(p => p === '/api/auth/google')).toHaveLength(0)
})
it('resets linking when the password changes during verification',async()=>{
  const f=fixture(),success=vi.fn();let resolve!:(r:Response)=>void;const fetcher=globalThis.fetch;
  vi.stubGlobal('fetch',(path:string,options:RequestInit)=>path==='/api/auth/google/link'?new Promise<Response>(r=>{resolve=r}):fetcher(path,options));
  const {GoogleSignIn}=await import('../src/components/GoogleSignIn');const view=render(<GoogleSignIn mode="link" password="first-password" onSuccess={success}/>);
  await screen.findByText('Official Google test button');await act(async()=>f.respond());
  expect(screen.getByRole('status')).toHaveTextContent('Verifying');
  view.rerender(<GoogleSignIn mode="link" password="changed-password" onSuccess={success}/>);
  expect(await screen.findByText('Official Google test button')).toBeVisible();
  await act(async()=>resolve(ok(result)));expect(success).not.toHaveBeenCalled();
});
it('ignores a callback after a newer password session is saved', async () => {
  const f = fixture(), success = vi.fn(); const { GoogleSignIn } = await import('../src/components/GoogleSignIn'); render(<GoogleSignIn onSuccess={success} />)
  await screen.findByText('Official Google test button')
  sessionStorage.setItem('cinehook.access-token', 'new-password-session'); await act(async () => f.respond()); expect(success).not.toHaveBeenCalled(); expect(f.calls.filter(p => p === '/api/auth/google')).toHaveLength(0)
})
it('ignores an in-flight Google result when password login disables the component', async () => {
  const f = fixture(), success = vi.fn(); let resolve!: (r: Response) => void
  const fetcher = globalThis.fetch; vi.stubGlobal('fetch', vi.fn((path: string, options: RequestInit) => path === '/api/auth/google' ? new Promise<Response>(r => { resolve = r }) : fetcher(path, options)))
  const { GoogleSignIn } = await import('../src/components/GoogleSignIn'); const view = render(<GoogleSignIn onSuccess={success} />)
  await screen.findByText('Official Google test button'); await act(async () => f.respond())
  view.rerender(<GoogleSignIn onSuccess={success} disabled />); await act(async () => resolve(ok(result))); expect(success).not.toHaveBeenCalled()
})
it('has an honest retry state when public configuration fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network'))); const { GoogleSignIn } = await import('../src/components/GoogleSignIn'); render(<GoogleSignIn onSuccess={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent(/Unable to connect/); expect(screen.getByRole('button', { name: 'Retry Google sign-in' })).toBeEnabled()
})
