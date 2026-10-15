import { Brand } from './Brand'

type Phase = 'location' | 'catalogue'
export function DiscoveryLoading({ phase, cityName }: { phase: Phase; cityName: string }) {
  const steps = [
    { title: 'Setting your location', detail: cityName ? 'Using ' + cityName : 'Choose or change your city anytime.' },
    { title: 'Finding cinemas and showtimes', detail: cityName ? 'Checking what is playing in ' + cityName + '.' : 'Checking available movie showtimes.' },
    { title: 'Preparing current offers', detail: 'Getting your CineHook home ready.' },
  ]
  const activeStep = phase === 'location' ? 0 : 1
  return <main className="discovery-loading" role="status" aria-live="polite">
    <section className="discovery-loading-card">
      <div className="discovery-loading-brand"><Brand /></div>
      <div className="discovery-loading-orbit" aria-hidden="true"><span /><span /><span /></div>
      <p className="eyebrow">A little movie magic, coming right up</p>
      <h1>Getting CineHook ready</h1>
      <p className="muted">We’re setting things up for your next great experience.</p>
      <ol className="discovery-loading-steps">
        {steps.map((step, index) => <li key={step.title} className={index < activeStep ? 'is-complete' : index === activeStep ? 'is-active' : ''}>
          <span className="discovery-step-mark" aria-hidden="true">{index < activeStep ? '✓' : index === activeStep ? <span className="discovery-step-spinner" /> : '•'}</span>
          <span><strong>{step.title}</strong><small>{step.detail}</small></span>
        </li>)}
      </ol>
      <div className="discovery-loading-progress" aria-hidden="true"><span className={phase === 'catalogue' ? 'catalogue-ready' : ''} /></div>
      <p className="discovery-loading-note">Your selected city stays in your control.</p>
    </section>
  </main>
}
