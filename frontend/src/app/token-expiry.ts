export function accessTokenExpiresAt(token: string): number | null {
  const encodedPayload = token.split('.')[1]
  if (!encodedPayload) return null
  try {
    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    const payload = JSON.parse(decoded) as { exp?: unknown }
    return typeof payload.exp === 'number' && Number.isSafeInteger(payload.exp) && payload.exp > 0
      ? payload.exp * 1000
      : null
  } catch {
    return null
  }
}

export function scheduleTokenExpiryLogout(token: string, onExpire: () => void): () => void {
  const expiresAt = accessTokenExpiresAt(token)
  if (expiresAt === null) return () => undefined
  const remaining = expiresAt - Date.now()
  if (remaining <= 0) { onExpire(); return () => undefined }
  const timer = setTimeout(onExpire, remaining)
  return () => clearTimeout(timer)
}
