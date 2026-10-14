export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div role="status" className="space-y-5 py-8" aria-live="polite"><p className="muted">{label}</p>
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">{[1, 2, 3, 4].map(id => <div key={id} className="skeleton h-64 rounded-2xl" />)}</div></div>
}
export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return <section className="panel p-6"><p role="alert" className="text-red-300">{error.message}</p>
    {retry && <button type="button" className="secondary mt-4" onClick={retry}>Retry</button>}</section>
}
export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return <section className="panel p-8 text-center"><h2 className="text-xl font-semibold">{title}</h2>{detail && <p className="muted mt-3">{detail}</p>}</section>
}
export function StatusBadge({ value }: { value: string }) {
  const success = value === 'CONFIRMED' || value === 'SUCCESS' || value === 'REFUNDED'
  return <span className={`status-badge ${success ? 'status-success' : value.includes('PENDING') ? 'status-pending' : 'status-neutral'}`}>{value.replaceAll('_', ' ')}</span>
}
