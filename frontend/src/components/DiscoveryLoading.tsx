export function DiscoveryLoading({ status }: { status: string }) {
  return <main className="discovery-loading" role="status" aria-live="polite">
    <span className="discovery-loading-spinner" aria-hidden="true" />
    <span>{status}</span>
  </main>
}
