import { expect, it } from 'vitest';
import { confirmedCancellationAllowed } from '../src/modules/booking/cancellation-policy.js';

const created = new Date('2030-01-01T10:00:00+05:30');
const starts = new Date('2030-01-03T10:00:00+05:30');
it.each([[0, true], [86_399_999, true], [86_400_000, false], [86_400_001, false], [-1, false]] as const)('checks original booking age %d milliseconds', (age, allowed) => {
  expect(confirmedCancellationAllowed(created, starts, new Date(created.getTime() + age))).toBe(allowed);
});
it.each([
  ['2030-01-01T23:58:00+05:30', '2030-01-01T23:59:00+05:30', '2030-01-02T00:01:00+05:30', true],
  ['2030-01-01T23:58:00+05:30', '2030-01-02T00:00:00+05:30', '2030-01-02T00:01:00+05:30', false],
  ['2030-01-02T00:00:00+05:30', '2030-01-02T00:01:00+05:30', '2030-01-02T23:59:00+05:30', false],
  ['2030-01-01T23:58:00+05:30', '2030-01-02T00:01:00+05:30', '2030-01-02T00:01:00+05:30', false],
  ['2030-01-01T23:58:00+05:30', '2030-01-02T00:02:00+05:30', '2030-01-02T00:01:00+05:30', false],
])('uses current Kolkata calendar date, before-start and no extra lead-time rule (%s, %s)', (booked, now, show, allowed) => {
  expect(confirmedCancellationAllowed(new Date(booked), new Date(show), new Date(now))).toBe(allowed);
});
