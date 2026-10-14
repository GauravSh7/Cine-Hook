export function profileAge(birth: string, now = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null
  const [year, month, day] = birth.split('-').map(Number), date = new Date(Date.UTC(year!, month! - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) return null
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  if (date.getTime() > today) return null
  return now.getFullYear() - year! - (now.getMonth() + 1 < month! || (now.getMonth() + 1 === month && now.getDate() < day!) ? 1 : 0)
}
