import { useEffect, useRef, type ReactNode } from 'react'

export function ConfirmDialog({ children, onClose, busy }: { children: ReactNode; onClose: () => void; busy: boolean }) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const original = document.body.style.overflow; document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => { document.body.style.overflow = original; if (previous?.isConnected) previous.focus() }
  }, [])
  return <div className="dialog-backdrop print:hidden"><section ref={panel} role="dialog" aria-modal="true" aria-labelledby="cancel-title" tabIndex={-1} className="panel max-w-lg p-7" onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() }
    if (event.key === 'Tab') {
      const targets = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      if (!targets.length) { event.preventDefault(); panel.current?.focus(); return }
      if (event.shiftKey && document.activeElement === targets[0]) { event.preventDefault(); targets.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === targets.at(-1)) { event.preventDefault(); targets[0]?.focus() }
    }
  }}>{children}</section></div>
}
