const WINDOW_MS = 24 * 60 * 60 * 1000;

function indiaDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

export function confirmedCancellationAllowed(createdAt: Date, startsAt: Date, now: Date): boolean {
  const age = now.getTime() - createdAt.getTime();
  const timeToShow = startsAt.getTime() - now.getTime();
  return Number.isFinite(age) && age >= 0 && age < WINDOW_MS
    && timeToShow > 0 && indiaDate(now) !== indiaDate(startsAt);
}
