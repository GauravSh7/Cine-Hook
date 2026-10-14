export function publicVenueLabel(value: string): string {
  return value
    .replace(/^CineHook\s+(?:Demo|Sample)\s+/i, '')
    .replace(/^Demo\s+Screen\s+/i, 'Audi ')
    .replace(/\b(?:Demo|Sample)\s+/gi, '')
    .trim()
}
