import { expect, it } from 'vitest'
import { profileAge } from '../src/domain/profile'

it.each([
  ['2000-02-29', '2026-02-28T12:00:00', 25],
  ['2000-02-29', '2026-03-01T12:00:00', 26],
  ['2000-10-08', '2026-10-07T12:00:00', 25],
  ['2000-10-08', '2026-10-08T12:00:00', 26],
  ['2001-02-29', '2026-10-08T12:00:00', null],
  ['2026-10-09', '2026-10-08T12:00:00', null],
  ['invalid', '2026-10-08T12:00:00', null],
] as const)('derives birthday age for %s on %s', (birth, now, expected) => {
  expect(profileAge(birth, new Date(now))).toBe(expected)
})
