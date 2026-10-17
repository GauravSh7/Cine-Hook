import { expect, it } from 'vitest'
import { confirmedCancellationAllowed } from '../src/domain/booking-target'

const created = '2030-01-01T10:00:00+05:30', starts = '2030-01-03T10:00:00+05:30'
it.each([[0, true], [86_399_999, true], [86_400_000, false], [86_400_001, false], [-1, false]] as const)('matches backend original-age cutoff at %d milliseconds', (age, allowed) => {
  expect(confirmedCancellationAllowed(created, starts, Date.parse(created) + age)).toBe(allowed)
})
it.each([
  ['2030-01-01T23:58:00+05:30', '2030-01-01T23:59:00+05:30', '2030-01-02T00:01:00+05:30', true],
  ['2030-01-01T23:58:00+05:30', '2030-01-02T00:00:00+05:30', '2030-01-02T00:01:00+05:30', false],
  ['2030-01-02T00:00:00+05:30', '2030-01-02T00:01:00+05:30', '2030-01-02T23:59:00+05:30', false],
  ['2030-01-01T23:58:00+05:30', '2030-01-02T00:01:00+05:30', '2030-01-02T00:01:00+05:30', false],
  ['2030-01-01T23:58:00+05:30', '2030-01-02T00:02:00+05:30', '2030-01-02T00:01:00+05:30', false],
])('matches backend current Kolkata date and start-time checks (%s, %s)', (booked, now, show, allowed) => {
  expect(confirmedCancellationAllowed(booked, show, Date.parse(now))).toBe(allowed)
})
