const photos: Record<string, string> = {
  events: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1600&q=85',
  sports: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1600&q=85',
  activities: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1600&q=85',
  stream: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1600&q=85',
}

export function experiencePhoto(kind: string, imageUrl?: string | null, identity = ''): string {
  if (imageUrl?.startsWith('https://')) return imageUrl
  if (imageUrl?.startsWith('/') && !imageUrl.startsWith('//') && !imageUrl.startsWith('/demo-category-art/')) return imageUrl
  if (!identity) return photos[kind.toLowerCase()] ?? photos.events!
  // Abstract, entry-specific fallback. Never substitute an unrelated stock photo.
  const hash = Array.from(identity).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0)
  const hue=hash%360
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><defs><linearGradient id="g"><stop stop-color="hsl(${hue} 45% 28%)"/><stop offset="1" stop-color="#10121e"/></linearGradient></defs><path fill="url(#g)" d="M0 0h800v450H0z"/><circle cx="${200+hash%350}" cy="225" r="180" fill="none" stroke="hsl(${hue} 55% 60%)" opacity=".3" stroke-width="2"/></svg>`)}`
}
